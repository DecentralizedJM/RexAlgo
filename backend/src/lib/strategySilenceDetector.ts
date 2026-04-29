import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { copyWebhookConfig, strategies } from "@/lib/schema";
import { queueNotification } from "@/lib/notifications";
import { logger } from "@/lib/logger";

export const STRATEGY_SILENCE_DAYS = 7;
const TICK_MS = 60 * 60 * 1000;
const SILENCE_REASON = `Paused automatically: no accepted webhook signal was received for ${STRATEGY_SILENCE_DAYS} days.`;

let workerStarted = false;
let workerTimer: ReturnType<typeof setInterval> | null = null;

type StaleStrategyRow = {
  id: string;
  name: string;
  creatorId: string;
  type: "algo" | "copy_trading";
  lastDeliveryAt: Date | null;
};

async function findStaleStrategies(): Promise<StaleStrategyRow[]> {
  return db
    .select({
      id: strategies.id,
      name: strategies.name,
      creatorId: strategies.creatorId,
      type: strategies.type,
      lastDeliveryAt: copyWebhookConfig.lastDeliveryAt,
    })
    .from(strategies)
    .innerJoin(copyWebhookConfig, eq(copyWebhookConfig.strategyId, strategies.id))
    .where(
      and(
        eq(strategies.status, "approved"),
        eq(strategies.isActive, true),
        lt(copyWebhookConfig.lastDeliveryAt, sql<Date>`now() - interval '7 days'`)
      )
    );
}

async function pauseStaleStrategy(row: StaleStrategyRow): Promise<boolean> {
  const updated = await db
    .update(strategies)
    .set({
      status: "draft",
      isActive: false,
      rejectionReason: SILENCE_REASON,
      reviewedBy: null,
      reviewedAt: null,
    })
    .where(
      and(
        eq(strategies.id, row.id),
        eq(strategies.status, "approved"),
        eq(strategies.isActive, true)
      )
    )
    .returning({ id: strategies.id });

  if (updated.length === 0) return false;

  await db
    .update(copyWebhookConfig)
    .set({ enabled: false })
    .where(eq(copyWebhookConfig.strategyId, row.id));

  void queueNotification(row.creatorId, {
    kind: "strategy_paused_for_silence",
    text:
      `⏸️ <b>${row.name}</b> was paused and moved back to setup.\n` +
      `Reason: no accepted webhook signal was received for ${STRATEGY_SILENCE_DAYS} days.\n` +
      `Send a fresh test signal, then submit for admin review to go live again.`,
    meta: {
      strategyId: row.id,
      type: row.type,
      lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
      silenceDays: STRATEGY_SILENCE_DAYS,
    },
  });

  return true;
}

export async function tickStrategySilenceDetector(): Promise<number> {
  const stale = await findStaleStrategies();
  let paused = 0;

  for (const row of stale) {
    try {
      if (await pauseStaleStrategy(row)) paused += 1;
    } catch (err) {
      logger.error(
        { err, strategyId: row.id },
        "[strategy-silence] failed to pause stale strategy"
      );
    }
  }

  if (paused > 0) {
    logger.info({ paused }, "[strategy-silence] paused stale strategies");
  }
  return paused;
}

export function ensureStrategySilenceDetectorWorker(): void {
  if (workerStarted) return;
  if (process.env.REXALGO_DISABLE_STRATEGY_SILENCE_DETECTOR === "1") return;
  workerStarted = true;

  void tickStrategySilenceDetector().catch((err) => {
    logger.error({ err }, "[strategy-silence] initial tick error");
  });

  workerTimer = setInterval(() => {
    void tickStrategySilenceDetector().catch((err) => {
      logger.error({ err }, "[strategy-silence] tick error");
    });
  }, TICK_MS);

  if (workerTimer && typeof workerTimer.unref === "function") {
    workerTimer.unref();
  }
}
