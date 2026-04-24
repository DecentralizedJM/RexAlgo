/**
 * Graceful shutdown coordinator.
 *
 * Registered from {@link ./db.ts} alongside pool creation so it runs inside
 * the Node runtime only (middleware + Edge routes never reach this file).
 * When the process receives SIGTERM / SIGINT (Railway redeploys, `kill` from
 * an operator), we:
 *
 *   1. flip an internal flag so new requests can opt-out early if needed;
 *   2. stop the notifications outbox interval so no new Telegram sends start;
 *   3. wait up to {@link DRAIN_TIMEOUT_MS} for in-flight requests to settle;
 *   4. end the Postgres pool so connections aren't abandoned.
 *
 * Exit-code policy: we always call `process.exit(0)` after the drain. The
 * supervisor (Railway) treats that as a clean shutdown. If the drain hangs
 * past {@link HARD_TIMEOUT_MS} we exit anyway — a stuck shutdown is worse
 * than a truncated request.
 */
import type { Pool } from "pg";

const DRAIN_TIMEOUT_MS = 10_000;
const HARD_TIMEOUT_MS = 15_000;

let installed = false;
let shuttingDown = false;
let inFlight = 0;

/** Public read-only flag so handlers can fast-fail when shutdown has begun. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Increment/decrement hooks for the middleware request counter. */
export function markRequestStart(): void {
  inFlight += 1;
}
export function markRequestEnd(): void {
  if (inFlight > 0) inFlight -= 1;
}

async function waitForDrain(): Promise<void> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function installShutdownHandlers(pool: Pool): void {
  if (installed) return;
  installed = true;

  const handler = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`[shutdown] received ${signal}, draining...`);

    const hardKill = setTimeout(() => {
      console.error("[shutdown] drain timed out, forcing exit");
      process.exit(1);
    }, HARD_TIMEOUT_MS);
    if (typeof hardKill.unref === "function") hardKill.unref();

    try {
      // Lazy import so this file stays runtime-agnostic; notifications module
      // has a Node-only db dependency.
      const { stopNotificationsWorker } = await import("./notifications");
      stopNotificationsWorker();
    } catch (err) {
      console.warn("[shutdown] failed to stop notifications worker:", err);
    }

    await waitForDrain();

    try {
      await pool.end();
    } catch (err) {
      console.warn("[shutdown] pool.end failed:", err);
    }

    console.warn("[shutdown] done, exiting");
    clearTimeout(hardKill);
    process.exit(0);
  };

  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
}
