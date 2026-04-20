-- Default leverage / risk % for TradingView manual-trade webhooks (saved in studio).
ALTER TABLE "tv_webhooks" ADD COLUMN IF NOT EXISTS "default_leverage" double precision NOT NULL DEFAULT 5;
ALTER TABLE "tv_webhooks" ADD COLUMN IF NOT EXISTS "default_risk_pct" double precision NOT NULL DEFAULT 2;
