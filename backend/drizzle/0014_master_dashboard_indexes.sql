-- Speeds owner-scoped master dashboard aggregates without exposing subscriber PII.
CREATE INDEX IF NOT EXISTS "subscriptions_strategy_active_idx"
  ON "subscriptions" ("strategy_id", "is_active");

CREATE INDEX IF NOT EXISTS "trade_logs_strategy_created_idx"
  ON "trade_logs" ("strategy_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "copy_signal_events_strategy_received_idx"
  ON "copy_signal_events" ("strategy_id", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "copy_mirror_attempts_signal_status_created_idx"
  ON "copy_mirror_attempts" ("signal_id", "status", "created_at" DESC);
