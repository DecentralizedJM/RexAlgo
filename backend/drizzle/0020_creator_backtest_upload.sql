-- Replace the simulated backtest engine (`sma_cross` / `rule_builder_v1`)
-- with a creator-uploaded backtest payload. The simulator could not model
-- SMC / order blocks / liquidity / volume strategies because it was driven
-- by a fixed indicator set against live Bybit klines. We now persist the
-- raw payload uploaded by the creator and let the panel render that.
--
-- We deliberately keep `backtest_spec_json` for now (existing rows may
-- carry a default `rule_builder_v1` spec). It is no longer read by the UI
-- or the public detail panel.
--
-- Columns:
--   `backtest_upload_kind`    — "json" (creator-supplied normalised payload)
--                              or "tv_export" (TradingView Strategy Tester
--                              CSV/JSON parsed server-side).
--   `backtest_upload_payload` — normalised payload (summary + equity + trades),
--                              stored as JSON-encoded text so it parallels
--                              the existing `backtest_spec_json` convention.
--   `backtest_upload_meta`    — { source, fileName, uploadedAt, ranges,
--                                 version } JSON.
ALTER TABLE "strategies"
  ADD COLUMN IF NOT EXISTS "backtest_upload_kind" text,
  ADD COLUMN IF NOT EXISTS "backtest_upload_payload" text,
  ADD COLUMN IF NOT EXISTS "backtest_upload_meta" text;
