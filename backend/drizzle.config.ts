import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit config (Postgres).
 *
 * Generate a new migration after editing schema.ts:
 *   cd backend && npx drizzle-kit generate
 *
 * Push schema directly (not used in this repo — we check in migrations):
 *   cd backend && npx drizzle-kit push
 */
export default {
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgres://rexalgo:rexalgo@127.0.0.1:5432/rexalgo",
  },
} satisfies Config;
