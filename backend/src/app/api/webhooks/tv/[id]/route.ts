/**
 * TradingView webhook ingress (Phase 5).
 *
 * Flow:
 *   1. Rate-limit per webhook id (shares the distributed bucket used by
 *      copy-trade webhooks — Redis when `REDIS_URL` is set, in-process Map
 *      otherwise — see `lib/copyWebhookRateLimit.ts`).
 *   2. Verify `X-RexAlgo-Signature: t=<unix>,v1=<hmac>` against the stored
 *      per-webhook secret.
 *   3. Parse the alert with `parseTvAlert` (simple `{ action, symbol, leverage,
 *      sl, tp, qty, risk_pct }` for manual mode, or the signed copy-signal for
 *      route-to-strategy).
 *   4. Insert into `tv_webhook_events` (unique on `(webhook_id, idempotency_key)`).
 *      Dedupe key is optional `id` / `idempotency_key` in the JSON; if omitted,
 *      a stable hash of the raw body is used so TradingView retries stay safe.
 *   5. Execute according to `mode`:
 *        - `route_to_strategy`  → delegate to `executeMirror` with the owned
 *          strategy (must be active).
 *        - `manual_trade`       → place a single order on the owner's Mudrex
 *          account, bounded by `tvWebhooks.maxMarginUsdt`.
 *   6. Update `lastDeliveryAt` (for the status pill in the studio list).
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  strategies,
  tvWebhookEvents,
  tvWebhooks,
  users,
} from "@/lib/schema";
import { decryptApiSecret } from "@/lib/auth";
import { verifyCopyWebhookSignature } from "@/lib/copyWebhookHmac";
import {
  parseTvAlert,
  roundBaseQtyToStep,
  tvWebhookDedupeKey,
  type ManualTradeIntent,
} from "@/lib/tvAlert";
import { executeMirror } from "@/lib/copyMirror";
import { queueNotification } from "@/lib/notifications";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { checkCopyWebhookRateLimit } from "@/lib/copyWebhookRateLimit";
import { enforceBodyLimit } from "@/lib/bodyLimit";
import {
  createOrder,
  getAsset,
  getFuturesBalance,
  listOpenPositions,
  closePosition,
  setLeverage,
} from "@/lib/mudrex";
import { computeFollowerQuantity } from "@/lib/copyMirror";
import { logTrade, markRexAlgoTradesClosed } from "@/lib/tradeLedger";
import { parseSymbolsJson } from "@/lib/strategyAssets";

function looksLikeKeyRejected(detail: string): boolean {
  const d = detail.toLowerCase();
  return (
    d.includes("mudrex rejected this api key") ||
    d.includes("expired") ||
    d.includes("revoked") ||
    d.includes("invalid")
  );
}

function looksLikeLowBalance(detail: string): boolean {
  const d = detail.toLowerCase();
  return (
    d.includes("insufficient") ||
    d.includes("not enough balance") ||
    d.includes("insufficient margin")
  );
}

async function recordEvent(
  webhookId: string,
  idempotencyKey: string,
  rawBody: string,
  status: "accepted" | "rejected" | "error",
  detail: string,
  clientIp: string
): Promise<void> {
  try {
    await db.insert(tvWebhookEvents).values({
      id: uuidv4(),
      webhookId,
      idempotencyKey,
      payloadJson: rawBody,
      status,
      detail: detail.slice(0, 500),
      clientIp,
    });
  } catch {
    /* duplicate dedupe key — TradingView retry — ignore silently */
  }
}

async function runManualTrade(
  intent: ManualTradeIntent,
  apiSecret: string,
  maxMarginUsdt: number,
  userId: string,
  tradeDefaults: { defaultLeverage: number; defaultRiskPct: number }
): Promise<{ ok: true; orderId: string } | { ok: false; detail: string }> {
  if (intent.action === "close") {
    try {
      const open = await listOpenPositions(apiSecret, "background");
      const matching = open.filter(
        (p) => p.symbol === intent.symbol && p.side === intent.side
      );
      if (matching.length === 0) {
        return { ok: false, detail: "No open position for symbol/side" };
      }
      const last = matching[matching.length - 1];
      const ok = await closePosition(apiSecret, last.position_id, "background");
      if (!ok) return { ok: false, detail: "closePosition returned false" };
      return { ok: true, orderId: last.position_id };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : "close failed",
      };
    }
  }

  let asset;
  try {
    asset = await getAsset(apiSecret, intent.symbol, "background");
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Failed to fetch asset",
    };
  }

  const mark = parseFloat(asset.price || "0");
  if (!Number.isFinite(mark) || mark <= 0) {
    return { ok: false, detail: "Asset mark price unavailable" };
  }

  const minQty = parseFloat(asset.min_quantity || "0");
  const step = parseFloat(asset.quantity_step || "0.001");

  const levStr =
    intent.leverageStr && intent.leverageStr.trim()
      ? intent.leverageStr.trim()
      : String(
          Math.min(
            100,
            Math.max(1, Math.round(Number(tradeDefaults.defaultLeverage) || 5))
          )
        );
  const levNum = parseFloat(levStr);
  if (!Number.isFinite(levNum) || levNum <= 0) {
    return { ok: false, detail: "Invalid leverage" };
  }

  const defRisk = Number(tradeDefaults.defaultRiskPct);
  const defaultRiskOk = Number.isFinite(defRisk) && defRisk >= 0 && defRisk <= 100;
  const effectiveRiskPct =
    intent.riskPct != null && intent.riskPct > 0
      ? intent.riskPct
      : defaultRiskOk && defRisk > 0
        ? defRisk
        : undefined;

  let qty: number;
  if (intent.baseQty != null && intent.baseQty > 0) {
    let q = roundBaseQtyToStep(intent.baseQty, minQty, step);
    const maxNotional = maxMarginUsdt * levNum;
    const maxQtyByCap = maxNotional / mark;
    q = Math.min(q, roundBaseQtyToStep(maxQtyByCap, minQty, step));
    qty = q;
  } else {
    let marginUsdt: number;
    if (intent.marginUsdtHint && intent.marginUsdtHint > 0) {
      marginUsdt = Math.min(intent.marginUsdtHint, maxMarginUsdt);
    } else if (effectiveRiskPct != null && effectiveRiskPct > 0) {
      try {
        const bal = await getFuturesBalance(apiSecret);
        const avail = parseFloat(bal.balance || "0");
        if (Number.isFinite(avail) && avail > 0) {
          marginUsdt = Math.min(maxMarginUsdt, (avail * effectiveRiskPct) / 100);
        } else {
          marginUsdt = maxMarginUsdt;
        }
      } catch {
        marginUsdt = maxMarginUsdt;
      }
    } else {
      marginUsdt = maxMarginUsdt;
    }
    qty = computeFollowerQuantity(marginUsdt, levNum, mark, minQty, step);
  }

  if (qty <= 0) {
    return {
      ok: false,
      detail:
        "Computed quantity below minimum — raise max margin cap, risk %, or qty",
    };
  }

  try {
    await setLeverage(
      apiSecret,
      intent.symbol,
      levStr,
      "ISOLATED",
      "background"
    );
  } catch {
    /* best-effort */
  }

  try {
    const order = await createOrder(
      apiSecret,
      {
        symbol: intent.symbol,
        side: intent.side,
        quantity: String(qty),
        leverage: levStr,
        triggerType: intent.trigger_type,
        price: intent.trigger_type === "LIMIT" ? intent.price : undefined,
        stoplosPrice: intent.stoplosPrice,
        takeprofitPrice: intent.takeprofitPrice,
      },
      "background"
    );
    void logTrade({
      userId,
      source: "tv",
      order,
      markPriceFallback: mark,
    });
    return { ok: true, orderId: order.order_id };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "createOrder failed",
    };
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const tooLarge = enforceBodyLimit(req);
  if (tooLarge) return tooLarge;

  if (!(await checkCopyWebhookRateLimit(`tv:${id}`))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const [wh] = await db
    .select()
    .from(tvWebhooks)
    .where(eq(tvWebhooks.id, id));
  if (!wh || !wh.enabled) {
    return NextResponse.json({ error: "Webhook disabled" }, { status: 403 });
  }

  let secretPlain: string;
  try {
    secretPlain = decryptApiSecret(wh.secretEncrypted);
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const sig = verifyCopyWebhookSignature(secretPlain, rawBody, req.headers);
  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseTvAlert(json, wh.mode);
  if (!parsed.ok) {
    await recordEvent(
      wh.id,
      `reject:${uuidv4()}`,
      rawBody,
      "rejected",
      parsed.reason,
      clientIp
    );
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  const idempotencyKey = tvWebhookDedupeKey(
    wh.id,
    rawBody,
    parsed.clientIdempotencyKey
  );

  const existing = await db
    .select({ id: tvWebhookEvents.id })
    .from(tvWebhookEvents)
    .where(
      and(
        eq(tvWebhookEvents.webhookId, wh.id),
        eq(tvWebhookEvents.idempotencyKey, idempotencyKey)
      )
    );
  if (existing.length > 0) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      message: "Already processed",
    });
  }

  if (parsed.route.kind === "copy_signal") {
    if (!wh.strategyId) {
      await recordEvent(wh.id, idempotencyKey, rawBody, "rejected",
        "Webhook is in route_to_strategy mode but has no strategy", clientIp);
      return NextResponse.json(
        { error: "Webhook has no strategy configured" },
        { status: 409 }
      );
    }
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(
        and(
          eq(strategies.id, wh.strategyId),
          eq(strategies.creatorId, wh.userId)
        )
      );
    if (!strategy) {
      await recordEvent(wh.id, idempotencyKey, rawBody, "rejected",
        "Strategy not found or no longer owned", clientIp);
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    const signalId = uuidv4();
    await recordEvent(wh.id, idempotencyKey, rawBody, "accepted", `routed to ${strategy.id}`, clientIp);
    await db
      .update(tvWebhooks)
      .set({ lastDeliveryAt: new Date() })
      .where(eq(tvWebhooks.id, wh.id));

    if (!strategy.isActive || strategy.status !== "approved") {
      return NextResponse.json({
        ok: true,
        mirrored: false,
        reason:
          strategy.status !== "approved"
            ? "strategy_not_approved"
            : "strategy_inactive",
      });
    }

    const allowedSymbols = parseSymbolsJson(strategy.symbolsJson, strategy.symbol);
    if (strategy.assetMode === "single" && parsed.route.signal.symbol !== strategy.symbol) {
      await recordEvent(wh.id, idempotencyKey, rawBody, "rejected",
        `Signal symbol must be ${strategy.symbol} for this single-asset strategy`, clientIp);
      return NextResponse.json(
        { error: `Signal symbol must be ${strategy.symbol} for this strategy` },
        { status: 400 }
      );
    }
    if (strategy.assetMode === "multi" && !allowedSymbols.includes(parsed.route.signal.symbol)) {
      await recordEvent(wh.id, idempotencyKey, rawBody, "rejected",
        `${parsed.route.signal.symbol} is not allowed for this strategy`, clientIp);
      return NextResponse.json(
        { error: `${parsed.route.signal.symbol} is not in this strategy's allowed symbol list` },
        { status: 400 }
      );
    }

    const summary = await executeMirror(strategy, parsed.route.signal, signalId);
    return NextResponse.json({ ok: true, mirrored: true, summary });
  }

  // manual_trade path: need the owner's Mudrex key
  const [owner] = await db
    .select({ apiSecretEncrypted: users.apiSecretEncrypted })
    .from(users)
    .where(eq(users.id, wh.userId));
  if (!owner?.apiSecretEncrypted) {
    await recordEvent(wh.id, idempotencyKey, rawBody, "error",
      "Owner has no Mudrex API key linked", clientIp);
    return NextResponse.json(
      { error: "Connect your Mudrex API key before using manual-trade alerts" },
      { status: 428 }
    );
  }

  let apiSecret: string;
  try {
    apiSecret = decryptApiSecret(owner.apiSecretEncrypted);
  } catch {
    await recordEvent(wh.id, idempotencyKey, rawBody, "error",
      "Failed to decrypt owner API credentials", clientIp);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const result = await runManualTrade(
    parsed.route,
    apiSecret,
    wh.maxMarginUsdt,
    wh.userId,
    {
      defaultLeverage: Number(wh.defaultLeverage ?? 5),
      defaultRiskPct: Number(wh.defaultRiskPct ?? 2),
    }
  );
  await recordEvent(
    wh.id,
    idempotencyKey,
    rawBody,
    result.ok ? "accepted" : "error",
    result.ok ? `order ${result.orderId}` : result.detail,
    clientIp
  );
  await db
    .update(tvWebhooks)
    .set({ lastDeliveryAt: new Date() })
    .where(eq(tvWebhooks.id, wh.id));

  if (!result.ok) {
    if (looksLikeKeyRejected(result.detail)) {
      void queueAdminNotification({
        kind: "admin_key_rejected",
        text:
          `🔑 <b>Mudrex key rejected</b>\n\n` +
          `Context: TradingView manual webhook\n` +
          `Webhook: <b>${wh.name}</b> · <code>${wh.id}</code>\n` +
          `User: <code>${wh.userId}</code>\n` +
          `Detail: ${result.detail}`,
        meta: { webhookId: wh.id, userId: wh.userId, detail: result.detail },
      });
    } else if (looksLikeLowBalance(result.detail)) {
      void queueAdminNotification({
        kind: "admin_user_low_balance",
        text:
          `💰 <b>Low/insufficient balance detected</b>\n\n` +
          `Context: TradingView manual webhook\n` +
          `Webhook: <b>${wh.name}</b> · <code>${wh.id}</code>\n` +
          `User: <code>${wh.userId}</code>\n` +
          `Detail: ${result.detail}`,
        meta: { webhookId: wh.id, userId: wh.userId, detail: result.detail },
      });
    }
    void queueNotification(wh.userId, {
      kind: "copy_mirror_error",
      text: `⚠️ TradingView webhook <b>${wh.name}</b> failed to execute: ${result.detail}`,
    });
    return NextResponse.json({ ok: false, error: result.detail }, { status: 502 });
  }

  if (parsed.route.action === "close") {
    void markRexAlgoTradesClosed({
      userId: wh.userId,
      symbol: parsed.route.symbol,
      side: parsed.route.side,
      positionId: result.orderId,
    });
  }

  void queueNotification(wh.userId, {
    kind: "tv_alert_executed",
    text:
      `📈 TradingView webhook <b>${wh.name}</b>\n` +
      `${parsed.route.action === "open" ? "Opened" : "Closed"} ${parsed.route.side} ${parsed.route.symbol}` +
      ` (${parsed.route.trigger_type}) · order <code>${result.orderId}</code>`,
  });
  return NextResponse.json({ ok: true, orderId: result.orderId });
}
