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
 *   - If it returns a soft error (network / 5xx / 429), we leave it `queued`,
 *     bump `attempts`, and try again in the next tick up to `MAX_ATTEMPTS`.
 *
 * The worker is started lazily the first time `ensureNotificationsWorker()` is
 * called (imported by `backend/src/lib/db.ts` during boot). Setting
 * `REXALGO_DISABLE_NOTIFICATIONS=1` turns it off for tests.
 */
import { v4 as uuidv4 } from "uuid";
import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsOutbox, users } from "@/lib/schema";
import { sendTelegramMessage, telegramBotConfigured } from "@/lib/telegram";

const TICK_MS = 5000;
const BATCH = 20;
const MAX_ATTEMPTS = 5;

export type NotificationKind =
  | "master_access_approved"
  | "master_access_rejected"
  | "copy_signal_received"
  | "copy_mirror_error"
  | "tv_alert_executed"
  | "strategy_deleted_by_admin";

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
    });
  } catch (e) {
    console.error("[notifications] enqueue failed", e);
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
      console.error("[notifications] tick error", e);
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

async function tick(): Promise<void> {
  // We only process Telegram today; other channels would fork here.
  if (!telegramBotConfigured()) return;

  const rows = await db
    .select({
      id: notificationsOutbox.id,
      userId: notificationsOutbox.userId,
      kind: notificationsOutbox.kind,
      payloadJson: notificationsOutbox.payloadJson,
      attempts: notificationsOutbox.attempts,
      telegramId: users.telegramId,
      telegramNotifyEnabled: users.telegramNotifyEnabled,
    })
    .from(notificationsOutbox)
    .innerJoin(users, eq(users.id, notificationsOutbox.userId))
    .where(
      and(
        eq(notificationsOutbox.status, "queued"),
        eq(notificationsOutbox.channel, "telegram"),
        lt(notificationsOutbox.attempts, MAX_ATTEMPTS)
      )
    )
    .orderBy(asc(notificationsOutbox.createdAt))
    .limit(BATCH);

  for (const row of rows) {
    if (!row.telegramId || !row.telegramNotifyEnabled) {
      await db
        .update(notificationsOutbox)
        .set({ status: "skipped", sentAt: new Date() })
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
        .set({ status: "failed", lastError: "Empty text", sentAt: new Date() })
        .where(eq(notificationsOutbox.id, row.id));
      continue;
    }

    const res = await sendTelegramMessage(row.telegramId, text);
    if (res.ok) {
      await db
        .update(notificationsOutbox)
        .set({
          status: "sent",
          sentAt: new Date(),
          attempts: row.attempts + 1,
          lastError: null,
        })
        .where(eq(notificationsOutbox.id, row.id));
    } else {
      const reason = res.reason;
      const hard = /blocked|chat not found|user is deactivated|bot was kicked/i.test(reason);
      const nextAttempts = row.attempts + 1;
      await db
        .update(notificationsOutbox)
        .set({
          status: hard || nextAttempts >= MAX_ATTEMPTS ? "failed" : "queued",
          attempts: nextAttempts,
          lastError: reason,
        })
        .where(eq(notificationsOutbox.id, row.id));
    }
  }
}
