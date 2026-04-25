import { optionalEnv } from "@/lib/requireEnv";

const REQUIRED_PROD_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
] as const;

function isBuildTime(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.npm_lifecycle_event === "build"
  );
}

function missing(name: string): boolean {
  return optionalEnv(name) === null;
}

/**
 * Fail closed for production deployments. This is intentionally runtime-only:
 * `next build` often runs before Railway/Vercel inject real secrets.
 */
export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== "production" || isBuildTime()) return;

  const missingRequired = REQUIRED_PROD_ENV.filter(missing);
  if (missingRequired.length > 0) {
    throw new Error(
      `[production-config] Missing required production env: ${missingRequired.join(", ")}`
    );
  }

  if (process.env.REXALGO_SCALE_MODE === "multi_instance" && missing("REDIS_URL")) {
    throw new Error(
      "[production-config] REDIS_URL is required when REXALGO_SCALE_MODE=multi_instance"
    );
  }

  const telegramConfigured =
    optionalEnv("TELEGRAM_BOT_TOKEN") !== null ||
    optionalEnv("TELEGRAM_BOT_USERNAME") !== null;
  if (telegramConfigured && missing("TELEGRAM_WEBHOOK_SECRET")) {
    throw new Error(
      "[production-config] TELEGRAM_WEBHOOK_SECRET is required when Telegram is configured"
    );
  }
  if (process.env.REXALGO_TELEGRAM_ALLOW_UNSIGNED === "1") {
    throw new Error(
      "[production-config] REXALGO_TELEGRAM_ALLOW_UNSIGNED is not allowed in production"
    );
  }
}
