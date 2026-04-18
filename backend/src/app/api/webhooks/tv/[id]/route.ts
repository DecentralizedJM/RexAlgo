/**
 * TradingView webhook ingress (Phase 5).
 *
 * Flow:
 *   1. Rate-limit per webhook id (reuses the in-memory bucket used by copy-trade
 *      webhooks; swap to Redis before horizontal scale — see repo TODOs).
 *   2. Verify `X-RexAlgo-Signature: t=<unix>,v1=<hmac>` against the stored
 *      per-webhook secret.
 *   3. Parse the alert with `parseTvAlert`. The adapter accepts both our native
 *      copy-signal envelope and a trader-friendly
 *      `{ ticker, action, qty, orderType, price, id }` template.
 *   4. Insert into `tv_webhook_events` (unique on `(webhook_id, idempotency_key)`
 *      so TV's at-least-once retries are harmless).
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
import { parseTvAlert, type ManualTradeIntent } from "@/lib/tvAlert";
import { executeMirror } from "@/lib/copyMirror";
import { queueNotification } from "@/lib/notifications";
import { checkCopyWebhookRateLimit } from "@/lib/copyWebhookRateLimit";
import {
  createOrder,
  getAsset,
  listOpenPositions,
  closePosition,
  setLeverage,
} from "@/lib/mudrex";
import { computeFollowerQuantity } from "@/lib/copyMirror";

/** Hard caps so a single alert can never place absurd notional. */
const FALLBACK_LEVERAGE = "5";

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
    /* duplicate idempotency key – TV retry – ignore silently */
  }
}

async function runManualTrade(
  intent: ManualTradeIntent,
  apiSecret: string,
  maxMarginUsdt: number
): Promise<{ ok: true; orderId: string } | { ok: false; detail: string }> {
  const margin =
    intent.marginUsdtHint && intent.marginUsdtHint > 0
      ? Math.min(intent.marginUsdtHint, maxMarginUsdt)
      : maxMarginUsdt;

  if (intent.action === "close") {
    try {
      const open = await listOpenPositions(apiSecret);
      const matching = open.filter(
        (p) => p.symbol === intent.symbol && p.side === intent.side
      );
      if (matching.length === 0) {
        return { ok: false, detail: "No open position for symbol/side" };
      }
      const last = matching[matching.length - 1];
      const ok = await closePosition(apiSecret, last.position_id);
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
    asset = await getAsset(apiSecret, intent.symbol);
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
  const lev = parseFloat(FALLBACK_LEVERAGE);
  const qty = computeFollowerQuantity(margin, lev, mark, minQty, step);
  if (qty <= 0) {
    return {
      ok: false,
      detail: "Computed quantity below minimum — raise maxMarginUsdt or qty hint",
    };
  }

  try {
    await setLeverage(apiSecret, intent.symbol, FALLBACK_LEVERAGE, "ISOLATED");
  } catch {
    /* best-effort */
  }

  try {
    const order = await createOrder(apiSecret, {
      symbol: intent.symbol,
      side: intent.side,
      quantity: String(qty),
      leverage: FALLBACK_LEVERAGE,
      triggerType: intent.trigger_type,
      price: intent.trigger_type === "LIMIT" ? intent.price : undefined,
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

  if (!checkCopyWebhookRateLimit(`tv:${id}`)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const rawBody = await req.text();
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
    await recordEvent(wh.id, `bad_${Date.now()}`, rawBody, "rejected", parsed.reason, clientIp);
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  const idempotencyKey =
    parsed.route.kind === "copy_signal"
      ? parsed.route.signal.idempotency_key
      : parsed.route.idempotency_key;

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

    if (!strategy.isActive) {
      return NextResponse.json({
        ok: true,
        mirrored: false,
        reason: "strategy_inactive",
      });
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

  const result = await runManualTrade(parsed.route, apiSecret, wh.maxMarginUsdt);
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
    void queueNotification(wh.userId, {
      kind: "copy_mirror_error",
      text: `⚠️ TV webhook <b>${wh.name}</b> failed to execute: ${result.detail}`,
    });
    return NextResponse.json({ ok: false, error: result.detail }, { status: 502 });
  }

  void queueNotification(wh.userId, {
    kind: "tv_alert_executed",
    text:
      `📈 TV webhook <b>${wh.name}</b>\n` +
      `${parsed.route.action === "open" ? "Opened" : "Closed"} ${parsed.route.side} ${parsed.route.symbol}` +
      ` (${parsed.route.trigger_type}) · order <code>${result.orderId}</code>`,
  });
  return NextResponse.json({ ok: true, orderId: result.orderId });
}
