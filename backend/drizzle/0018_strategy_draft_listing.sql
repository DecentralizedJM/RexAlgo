-- New listings start as draft (setup) until the owner submits for admin review.
ALTER TABLE "strategies" ALTER COLUMN "status" SET DEFAULT 'draft';

-- Listings that were stuck in the admin queue without a verified webhook move
-- back to draft so owners complete setup (TradingView / bot test signal) before resubmitting.
UPDATE "strategies" AS s
SET "status" = 'draft'
WHERE s."status" = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM "copy_webhook_config" AS c
    WHERE c."strategy_id" = s."id"
      AND c."enabled" = true
      AND c."last_delivery_at" IS NOT NULL
  );
