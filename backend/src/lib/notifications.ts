/**
 * Notifications outbox (Phase 6).
 *
 * Event emitters across the codebase call `queueNotification(...)`; a short
 * interval worker in this same file reads any `queued` rows, dispatches them
 * via Telegram, and updates status.
 *
 * Delivery is best-effort:
 *   - If `telegramNotifyEnabled` is `false` or the user has no Telegram linked,
 *     the row moves to `skipped` immediately (no retry, no error).
 *   - If the Telegram Bot API returns a hard error (blocked user, invalid chat
 *     id), we mark `failed` and do not retry.
 *   - If it returns a soft error (network / 5xx / 429), we keep the row
 *     `queued`, bump `attempts` + `consecutive_failures`, set `next_retry_at`
 *     with exponential backoff (1s, 2s, 4s, 8s, 16s), up to `MAX_ATTEMPTS`.
 *
 * Global circuit breaker: after 10 consecutive soft Telegram API failures
 * across the worker, all dispatch pauses ~10 minutes (Redis when available,
 * else in-process). Successful sends reset the soft-failure streak.
 *
 * The worker is started lazily the first time `ensureNotificationsWorker()` is
 * called (from `ensureDbReady()` in `lib/db.ts` after migrations + seed). Setting
 * `REXALGO_DISABLE_NOTIFICATIONS=1` turns it off for tests.
 */
import { v4 as uuidv4 } from "uuid";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsOutbox, users } from "@/lib/schema";
import { sendTelegramMessage, telegramBotConfigured } from "@/lib/telegram";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const TICK_MS = 5000;
const BATCH = 20;
const MAX_ATTEMPTS = 5;
const PROCESSING_LEASE_MS = 120_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;
const TG_SOFT_STREAK_LIMIT = 10;
const TG_PAUSE_MS = 600_000;

const REDIS_PAUSE_UNTIL = "rexalgo:notify:tg_pause_until";
const REDIS_SOFT_STREAK = "rexalgo:notify:tg_soft_streak";

let memSoftStreak = 0;
let memPauseUntil = 0;

function backoffMsForConsecutiveFailures(cf: number): number {
  const idx = Math.min(Math.max(cf - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

async function telegramCircuitOpen(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return Date.now() < memPauseUntil;
  }
  try {
    const v = await redis.get(REDIS_PAUSE_UNTIL);
    if (!v) return false;
    const until = Number(v);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

async function recordTelegramSoftFailure(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memSoftStreak += 1;
    if (memSoftStreak >= TG_SOFT_STREAK_LIMIT) {
      memPauseUntil = Date.now() + TG_PAUSE_MS;
      memSoftStreak = 0;
      logger.warn(
        { pauseMs: TG_PAUSE_MS },
        "[notifications] telegram circuit open (in-memory)"
      );
    }
    return;
  }
  try {
    const n = await redis.incr(REDIS_SOFT_STREAK);
    if (n === 1) {
      await redis.pexpire(REDIS_SOFT_STREAK, 120_000);
    }
    if (n >= TG_SOFT_STREAK_LIMIT) {
      const until = Date.now() + TG_PAUSE_MS;
      await redis.set(REDIS_PAUSE_UNTIL, String(until), "PX", TG_PAUSE_MS + 15_000);
      await redis.del(REDIS_SOFT_STREAK);
      logger.warn(
        { pauseMs: TG_PAUSE_MS },
        "[notifications] telegram circuit open (redis)"
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[notifications] circuit redis error"
    );
  }
}

async function recordTelegramSendOk(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memSoftStreak = 0;
    return;
  }
  try {
    await redis.del(REDIS_SOFT_STREAK);
  } catch {
    /* ignore */
  }
}

export type NotificationKind =
  | "master_access_approved"
  | "master_access_rejected"
  | "master_access_revoked"
  | "copy_signal_received"
  | "copy_mirror_error"
  | "tv_alert_executed"
  | "strategy_deleted_by_admin"
  | "strategy_approved"
  | "strategy_rejected"
  | "strategy_requeued_for_review"
  | "strategy_submitted_for_review"
  | "strategy_slots_approved"
  | "strategy_slots_rejected";

export type NotificationPayload = {
  kind: NotificationKind;
  /** Plain-text message body — dispatched as-is to Telegram. */
  text: string;
  /** Optional free-form metadata stored alongside the row for later debugging. */
  meta?: Record<string, unknown>;
};

export async function queueNotification(
  userId: string,
  payload: NotificationPayload
): Promise<void> {
  try {
    await db.insert(notificationsOutbox).values({
      id: uuidv4(),
      userId,
      kind: payload.kind,
      channel: "telegram",
      payloadJson: JSON.stringify(payload),
      status: "queued",
      attempts: 0,
      consecutiveFailures: 0,
      nextRetryAt: null,
    });
  } catch (e) {
    logger.error({ err: e }, "[notifications] enqueue failed");
  }
}

let workerStarted = false;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function ensureNotificationsWorker(): void {
  if (workerStarted) return;
  if (process.env.REXALGO_DISABLE_NOTIFICATIONS === "1") return;
  workerStarted = true;
  workerTimer = setInterval(() => {
    void tick().catch((e) => {
      logger.error({ err: e }, "[notifications] tick error");
    });
  }, TICK_MS);
  // Don't keep the event loop alive just for the worker.
  if (workerTimer && typeof workerTimer.unref === "function") {
    workerTimer.unref();
  }
}

export function stopNotificationsWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerStarted = false;
}

type ClaimedNotificationRow = {
  id: string;
  userId: string;
  kind: string;
  payloadJson: string;
  attempts: number;
  consecutiveFailures: number;
  telegramId: string | null;
  telegramChatId: string | null;
  telegramConnected: boolean;
  telegramNotifyEnabled: boolean;
};

async function claimRows(): Promise<ClaimedNotificationRow[]> {
  const res = (await db.execute(sql`
    update ${notificationsOutbox} as n
    set
      status = 'processing',
      processing_expires_at = now() + (${PROCESSING_LEASE_MS} || ' milliseconds')::interval
    from ${users} as u
    where n.id in (
      select n2.id
      from ${notificationsOutbox} as n2
      where (
          n2.status = 'queued'
          or (n2.status = 'processing' and n2.processing_expires_at <= now())
        )
        and n2.channel = 'telegram'
        and n2.attempts < ${MAX_ATTEMPTS}
        and (n2.next_retry_at is null or n2.next_retry_at <= now())
      order by n2.created_at
      limit ${BATCH}
      for update skip locked
    )
      and u.id = n.user_id
    returning
      n.id,
      n.user_id,
      n.kind,
      n.payload_json,
      n.attempts,
      n.consecutive_failures,
      u.telegram_id,
      u.telegram_chat_id,
      u.telegram_connected,
      u.telegram_notify_enabled
  `)) as unknown as {
    rows: Array<{
      id: string;
      user_id: string;
      kind: string;
      payload_json: string;
      attempts: number;
      consecutive_failures: number;
      telegram_id: string | null;
      telegram_chat_id: string | null;
      telegram_connected: boolean;
      telegram_notify_enabled: boolean;
    }>;
  };

  return (res.rows ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    payloadJson: r.payload_json,
    attempts: Number(r.attempts ?? 0),
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    telegramId: r.telegram_id,
    telegramChatId: r.telegram_chat_id,
    telegramConnected: Boolean(r.telegram_connected),
    telegramNotifyEnabled: Boolean(r.telegram_notify_enabled),
  }));
}

async function tick(): Promise<void> {
  // We only process Telegram today; other channels would fork here.
  if (!telegramBotConfigured()) return;
  if (await telegramCircuitOpen()) return;

  const rows = await claimRows();

  for (const row of rows) {
    // Prefer `chat_id` captured during `/start`; fall back to `telegram_id`
    // (identical for private chats) for rows that predate bot-first login.
    const chatId = row.telegramChatId ?? row.telegramId;
    if (!chatId || !row.telegramNotifyEnabled || !row.telegramConnected) {
      await db
        .update(notificationsOutbox)
        .set({
          status: "skipped",
          sentAt: new Date(),
          nextRetryAt: null,
          processingExpiresAt: null,
        })
        .where(eq(notificationsOutbox.id, row.id));
      continue;
    }

    let text = "";
    try {
      const parsed = JSON.parse(row.payloadJson) as NotificationPayload;
      text = typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      text = "";
    }
    if (!text) {
      await db
        .update(notificationsOutbox)
        .set({
          status: "failed",
          lastError: "Empty text",
          sentAt: new Date(),
          nextRetryAt: null,
          processingExpiresAt: null,
        })
        .where(eq(notificationsOutbox.id, row.id));
      continue;
    }

    const res = await sendTelegramMessage(chatId, text);
    if (res.ok) {
      await recordTelegramSendOk();
      await db
        .update(notificationsOutbox)
        .set({
          status: "sent",
          sentAt: new Date(),
          attempts: row.attempts + 1,
          consecutiveFailures: 0,
          lastError: null,
          nextRetryAt: null,
          processingExpiresAt: null,
        })
        .where(eq(notificationsOutbox.id, row.id));
    } else {
      const reason = res.reason;
      const hard = /blocked|chat not found|user is deactivated|bot was kicked/i.test(
        reason
      );
      const nextAttempts = row.attempts + 1;
      const nextConsecutive = hard ? row.consecutiveFailures : row.consecutiveFailures + 1;
      const delayMs = hard ? 0 : backoffMsForConsecutiveFailures(nextConsecutive);
      const nextRetryAt = hard
        ? null
        : new Date(Date.now() + delayMs);

      if (!hard) {
        await recordTelegramSoftFailure();
      }

      // Hard error ⇒ bot can't reach this user anymore. Flip
      // `telegramConnected` off so the UI can prompt them to re-run the
      // one-tap flow, and so subsequent notifications short-circuit to
      // `skipped` instead of burning retry budget.
      if (hard) {
        await db
          .update(users)
          .set({ telegramConnected: false })
          .where(eq(users.id, row.userId));
      }

      const giveUp =
        hard || nextAttempts >= MAX_ATTEMPTS || (!hard && nextConsecutive >= MAX_ATTEMPTS);

      await db
        .update(notificationsOutbox)
        .set({
          status: giveUp ? "failed" : "queued",
          attempts: nextAttempts,
          consecutiveFailures: hard ? row.consecutiveFailures : nextConsecutive,
          lastError: reason,
          nextRetryAt: giveUp ? null : nextRetryAt,
          processingExpiresAt: null,
        })
        .where(eq(notificationsOutbox.id, row.id));
    }
  }
}
