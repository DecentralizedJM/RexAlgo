/**
 * Runs once per Node process before the server accepts traffic.
 *
 * Migrations used to block every `import "@/lib/db"` via top-level await, which
 * made the first sign-in / health check hang until Postgres finished all
 * migrations + seed. Moving that work here keeps module load fast and matches
 * how operators expect deploy-time migrations to behave.
 *
 * Skipped when `REXALGO_SKIP_DB_BOOT=1` (Docker image build + sqlite import script).
 */
export async function register() {
  if (process.env.REXALGO_SKIP_DB_BOOT === "1") {
    return;
  }
  const { ensureDbReady } = await import("@/lib/db");
  await ensureDbReady();
  const { ensureNotificationsWorker } = await import("@/lib/notifications");
  ensureNotificationsWorker();
}
