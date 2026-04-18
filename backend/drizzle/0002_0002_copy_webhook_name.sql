ALTER TABLE "copy_webhook_config" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "copy_webhook_config" ADD COLUMN "last_delivery_at" timestamp with time zone;--> statement-breakpoint
UPDATE "copy_webhook_config" SET "name" = COALESCE("name", (SELECT "name" FROM "strategies" WHERE "strategies"."id" = "copy_webhook_config"."strategy_id"));
