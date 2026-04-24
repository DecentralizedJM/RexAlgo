import { NextRequest, NextResponse } from "next/server";
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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ strategyId: string }> }
) {
  const { strategyId } = await ctx.params;

  if (!(await checkCopyWebhookRateLimit(strategyId))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const rawBody = await req.text();

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

  const sig = verifyCopyWebhookSignature(secretPlain, rawBody, req.headers);
  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseCopySignalV1(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  const { signal } = parsed;

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

  await db.insert(copySignalEvents).values({
    id: signalId,
    strategyId,
    idempotencyKey: signal.idempotency_key,
    payloadJson: rawBody,
    clientIp,
  });

  await db
    .update(copyWebhookConfig)
    .set({ lastDeliveryAt: new Date() })
    .where(eq(copyWebhookConfig.strategyId, strategyId));

  if (!strategy.isActive || strategy.status !== "approved") {
    return NextResponse.json({
      ok: true,
      mirrored: false,
      reason:
        strategy.status !== "approved"
          ? "strategy_not_approved"
          : "strategy_inactive",
      signalId,
      summary: { processed: 0, ok: 0, errors: 0 },
    });
  }

  const summary = await executeMirror(strategy, signal, signalId);

  return NextResponse.json({
    ok: true,
    mirrored: true,
    signalId,
    summary,
  });
}
