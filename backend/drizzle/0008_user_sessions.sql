-- Server-side browser sessions. The `rexalgo_session` cookie now carries an
-- opaque session id (inside a signed JWS wrapper); every authenticated request
-- SELECTs this row to confirm the session has not been revoked or expired.
--
-- Migration safety: existing JWT cookies (pre-0008) keep working as long as
-- code still accepts the legacy claim shape. When callers are switched over,
-- those cookies are rejected on the next request because they do not carry
-- a `sid` claim — users sign in again and a fresh row is written here.
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_agent" text,
	"auth_provider" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_user_idx"
  ON "user_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_expires_idx"
  ON "user_sessions" ("expires_at");
