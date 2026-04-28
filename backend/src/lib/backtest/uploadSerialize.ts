/**
 * Lift the raw `backtest_upload_*` text columns off a `strategies` row into
 * a typed object the frontend can consume directly:
 *
 *   strategy.backtestUpload = { kind, payload, meta } | null
 *
 * The DB stores JSON-encoded text (matching the existing
 * `backtest_spec_json` column convention). Doing the parse server-side
 * keeps the wire format the same shape we validated on upload, instead of
 * leaking the encoding choice into every API consumer.
 */
import {
  type UploadedBacktest,
  type UploadedBacktestKind,
  type UploadedBacktestMeta,
} from "./uploadSchema";

export type StrategyBacktestUpload = {
  kind: UploadedBacktestKind;
  payload: UploadedBacktest;
  meta: UploadedBacktestMeta;
};

/**
 * Returns a `StrategyBacktestUpload` derived from the row, or `null` if
 * the creator hasn't uploaded a backtest yet (or the stored blob is
 * unparseable — we treat that as missing rather than throwing because
 * misparsing should not break the listing entirely).
 */
export function deserializeBacktestUpload(row: {
  backtestUploadKind: string | null;
  backtestUploadPayload: string | null;
  backtestUploadMeta: string | null;
}): StrategyBacktestUpload | null {
  const kind = row.backtestUploadKind;
  if (kind !== "json" && kind !== "tv_export") return null;
  if (!row.backtestUploadPayload) return null;
  try {
    const payload = JSON.parse(row.backtestUploadPayload) as UploadedBacktest;
    const meta = row.backtestUploadMeta
      ? (JSON.parse(row.backtestUploadMeta) as UploadedBacktestMeta)
      : ({
          source: kind,
          uploadedAt: new Date(0).toISOString(),
          version: 0,
        } as UploadedBacktestMeta);
    return { kind, payload, meta };
  } catch {
    return null;
  }
}

/**
 * Decorate a row with a parsed `backtestUpload` field, leaving the raw
 * text columns in place for write-side compatibility.
 */
export function withBacktestUpload<T extends {
  backtestUploadKind: string | null;
  backtestUploadPayload: string | null;
  backtestUploadMeta: string | null;
}>(row: T): T & { backtestUpload: StrategyBacktestUpload | null } {
  return {
    ...row,
    backtestUpload: deserializeBacktestUpload(row),
  };
}
