import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  strategies,
  copyWebhookConfig,
  copySignalEvents,
} from "@/lib/schema";
import { decryptApiSecret } from "@/lib/auth";
import { verifyCopyWebhookSignature } from "@/lib/copyWebhookHmac";
import { parseCopySignalV1, executeMirror } from "@/lib/copyMirror";
import { checkCopyWebhookRateLimit } from "@/lib/copyWebhookRateLimit";
import { enforceBodyLimit } from "@/lib/bodyLimit";
import { queueNotification } from "@/lib/notifications";
import { parseSymbolsJson } from "@/lib/strategyAssets";

function secretMatches(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length > 0 && ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function redactSecretPayload(rawBody: string, json: unknown): string {
  if (!json || typeof json !== "object") return rawBody;
  const o = { ...(json as Record<string, unknown>) };
  if ("secret" in o) o.secret = "[redacted]";
  return JSON.stringify(o);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

function notifySignalAccepted(
  creatorId: string,
  args: {
    strategyId: string;
    strategyName: string;
    signalId: string;
    action: "open" | "close";
    symbol: string;
    side: "LONG" | "SHORT";
    mirrored: boolean;
    processed: number;
    ok: number;
    errors: number;
    reason?: string;
  }
): void {
  const status = args.mirrored
    ? `Processed ${args.processed} subscribers (${args.ok} ok, ${args.errors} errors).`
    : `Accepted but not mirrored: ${args.reason ?? "not eligible"}.`;

  void queueNotification(creatorId, {
    kind: "copy_signal_received",
    text:
      `Copy signal received for <b>${args.strategyName}</b>\n` +
      `${args.action.toUpperCase()} ${args.side} ${args.symbol}\n` +
      `${status}\n` +
      `Signal: <code>${args.signalId}</code>`,
    meta: {
      strategyId: args.strategyId,
      signalId: args.signalId,
      action: args.action,
      symbol: args.symbol,
      side: args.side,
      mirrored: args.mirrored,
      processed: args.processed,
      ok: args.ok,
      errors: args.errors,
      reason: args.reason ?? null,
    },
  });
}

/** POST handler for strategy mirror webhooks (algo + copy_trading). */
export async function postStrategySignalWebhook(
  req: NextRequest,
  strategyId: string
): Promise<NextResponse> {
  const tooLarge = enforceBodyLimit(req);
  if (tooLarge) return tooLarge;

  if (!(await checkCopyWebhookRateLimit(strategyId))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (
    !strategy ||
    (strategy.type !== "copy_trading" && strategy.type !== "algo")
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [wh] = await db
    .select()
    .from(copyWebhookConfig)
    .where(eq(copyWebhookConfig.strategyId, strategyId));

  if (!wh || !wh.enabled) {
    return NextResponse.json({ error: "Webhook disabled" }, { status: 403 });
  }

  let secretPlain: string;
  try {
    secretPlain = decryptApiSecret(wh.secretEncrypted);
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodySecret =
    json && typeof json === "object" && typeof (json as { secret?: unknown }).secret === "string"
      ? String((json as { secret: string }).secret)
      : null;
  const sig = verifyCopyWebhookSignature(secretPlain, rawBody, req.headers);
  if (!sig.ok && (!bodySecret || !secretMatches(bodySecret, secretPlain))) {
    return NextResponse.json(
      { error: bodySecret ? "Invalid webhook secret" : sig.reason },
      { status: 401 }
    );
  }

  const parsed = parseCopySignalV1(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  const { signal } = parsed;
  const allowedSymbols = parseSymbolsJson(strategy.symbolsJson, strategy.symbol);
  if (strategy.assetMode === "single" && signal.symbol !== strategy.symbol) {
    return NextResponse.json(
      { error: `Signal symbol must be ${strategy.symbol} for this single-asset strategy` },
      { status: 400 }
    );
  }
  if (strategy.assetMode === "multi" && !allowedSymbols.includes(signal.symbol)) {
    return NextResponse.json(
      { error: `${signal.symbol} is not in this strategy's allowed symbol list` },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: copySignalEvents.id })
    .from(copySignalEvents)
    .where(
      and(
        eq(copySignalEvents.strategyId, strategyId),
        eq(copySignalEvents.idempotencyKey, signal.idempotency_key)
      )
    );

  if (existing.length > 0) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      message: "Already processed",
    });
  }

  const signalId = uuidv4();
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  try {
    await db.insert(copySignalEvents).values({
      id: signalId,
      strategyId,
      idempotencyKey: signal.idempotency_key,
      payloadJson: redactSecretPayload(rawBody, json),
      clientIp,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        message: "Already processed",
      });
    }
    throw err;
  }

  await db
    .update(copyWebhookConfig)
    .set({ lastDeliveryAt: new Date() })
    .where(eq(copyWebhookConfig.strategyId, strategyId));

  if (!strategy.isActive || strategy.status !== "approved") {
    const reason =
      strategy.status !== "approved" ? "strategy_not_approved" : "strategy_inactive";
    notifySignalAccepted(strategy.creatorId, {
      strategyId,
      strategyName: strategy.name,
      signalId,
      action: signal.action,
      symbol: signal.symbol,
      side: signal.side,
      mirrored: false,
      processed: 0,
      ok: 0,
      errors: 0,
      reason,
    });
    return NextResponse.json({
      ok: true,
      mirrored: false,
      reason,
      signalId,
      summary: { processed: 0, ok: 0, errors: 0 },
    });
  }

  const summary = await executeMirror(strategy, signal, signalId);
  notifySignalAccepted(strategy.creatorId, {
    strategyId,
    strategyName: strategy.name,
    signalId,
    action: signal.action,
    symbol: signal.symbol,
    side: signal.side,
    mirrored: true,
    processed: summary.processed,
    ok: summary.ok,
    errors: summary.errors,
  });

  return NextResponse.json({
    ok: true,
    mirrored: true,
    signalId,
    summary,
  });
}
