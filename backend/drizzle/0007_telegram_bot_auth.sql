-- Bot-first Telegram login (deep-link `/start rexalgo_<token>`).
--
-- * `telegram_login_tokens` stores short-lived login intents. A row is created
--   the moment a user taps "Log in with Telegram"; the bot webhook updates it
--   to `claimed` on `/start`; the frontend poll consumes it (`used`).
-- * `users.telegram_chat_id` is the chat.id captured during `/start`. It
--   mirrors `telegram_id` for private chats today but lets us DM groups in
--   future without another migration.
-- * `users.telegram_connected` flips to true once the bot has ever received a
--   message from the user, which is the only state in which `sendMessage` will
--   succeed.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_connected" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Users that already linked Telegram via the legacy login widget have proven
-- ownership but we don't yet know a chat_id; they become `connected = true`
-- only after the bot sees a `/start`. To avoid losing working delivery paths
-- for existing installs, treat their `telegram_id` as a chat_id (identical
-- for private chats) and mark them connected. New rows default to false.
UPDATE "users"
SET "telegram_chat_id" = "telegram_id",
    "telegram_connected" = true
WHERE "telegram_id" IS NOT NULL
  AND "telegram_chat_id" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "telegram_login_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"link_user_id" text,
	"user_id" text,
	"telegram_id" text,
	"telegram_username" text,
	"return_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "telegram_login_tokens"
  ADD CONSTRAINT "telegram_login_tokens_link_user_id_users_id_fk"
  FOREIGN KEY ("link_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_login_tokens"
  ADD CONSTRAINT "telegram_login_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_login_tokens_status_expires_idx"
  ON "telegram_login_tokens" ("status", "expires_at");
