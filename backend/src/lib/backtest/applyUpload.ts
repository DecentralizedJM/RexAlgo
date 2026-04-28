/**
 * Shared logic for the studio backtest upload routes (marketplace + copy
 * trading). Validates the body, persists the canonical payload, and
 * encodes the divergent "what does an upload do to an approved listing"
 * rules so each route stays a thin shell.
 *
 * Type-specific differences:
 *   - `algo`: re-uploads while approved demote the listing to `draft` and
 *     disable the webhook (mirrors the marketplace studio PATCH).
 *   - `copy_trading`: approved listings are locked end-to-end (subscribers
 *     trust the reviewed parameters); we refuse uploads with 409.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { copyWebhookConfig, strategies } from "@/lib/schema";
import {
  UPLOAD_MAX_BYTES,
  UPLOADED_BACKTEST_VERSION,
  validateUploadedBacktest,
  type UploadedBacktest,
  type UploadedBacktestKind,
  type UploadedBacktestMeta,
} from "./uploadSchema";
import { parseTvExport } from "./parseTvExport";

export type ApplyUploadInput = {
  kind: UploadedBacktestKind;
  /** Raw upload body — string for `tv_export`, object/string for `json`. */
  body: unknown;
  /** Display name — usually the original file name. */
  fileName?: string | null;
};

export type ApplyUploadResult =
  | {
      ok: true;
      payload: UploadedBacktest;
      meta: UploadedBacktestMeta;
      requeueForReview: boolean;
    }
  | { ok: false; status: 400 | 409 | 413; code: string; message: string };

function fail(
  status: 400 | 409 | 413,
  code: string,
  message: string
): ApplyUploadResult {
  return { ok: false, status, code, message };
}

function bodyByteLength(body: unknown): number {
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (body == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return 0;
  }
}

/**
 * Validate + persist an upload for a strategy already verified to be owned
 * by the current user. The caller is responsible for the ownership check
 * and for `revalidatePublicStrategiesList()` afterwards.
 */
export async function applyBacktestUpload(
  strategyId: string,
  strategyType: "algo" | "copy_trading",
  status: "draft" | "pending" | "on_hold" | "approved" | "rejected",
  input: ApplyUploadInput
): Promise<ApplyUploadResult> {
  if (bodyByteLength(input.body) > UPLOAD_MAX_BYTES) {
    return fail(
      413,
      "UPLOAD_TOO_LARGE",
      `Upload exceeds ${UPLOAD_MAX_BYTES} byte cap. Trim trades or summarise first.`
    );
  }

  // Resolve to the canonical payload shape.
  let candidate: unknown;
  if (input.kind === "tv_export") {
    if (typeof input.body !== "string") {
      return fail(
        400,
        "UPLOAD_TV_BODY_TYPE",
        "TradingView uploads must be sent as a string (CSV or JSON text)."
      );
    }
    const parsed = parseTvExport(input.body);
    if (!parsed.ok) return parsed;
    candidate = parsed.value;
  } else if (input.kind === "json") {
    candidate =
      typeof input.body === "string"
        ? safeJsonParse(input.body)
        : input.body;
    if (candidate === undefined) {
      return fail(
        400,
        "UPLOAD_JSON_PARSE",
        "Could not parse the JSON body. Make sure it is valid JSON."
      );
    }
  } else {
    return fail(400, "UPLOAD_KIND_INVALID", "Unsupported upload kind");
  }

  const validation = validateUploadedBacktest(candidate);
  if (!validation.ok) {
    return fail(400, validation.code, validation.message);
  }

  // Type-specific rules for editing an approved listing.
  let requeueForReview = false;
  if (status === "approved") {
    if (strategyType === "copy_trading") {
      return fail(
        409,
        "STRATEGY_LOCKED",
        "Approved copy-trading listings are locked. Pause and create a fresh version if you need to publish a new backtest."
      );
    }
    requeueForReview = true;
  }

  const meta: UploadedBacktestMeta = {
    source: input.kind,
    uploadedAt: new Date().toISOString(),
    version: UPLOADED_BACKTEST_VERSION,
    ranges: {
      start: validation.value.summary.rangeStart,
      end: validation.value.summary.rangeEnd,
    },
    ...(input.fileName ? { fileName: input.fileName } : {}),
  };

  const updates: Partial<typeof strategies.$inferInsert> = {
    backtestUploadKind: input.kind,
    backtestUploadPayload: JSON.stringify(validation.value),
    backtestUploadMeta: JSON.stringify(meta),
  };
  if (requeueForReview) {
    updates.status = "draft";
    updates.rejectionReason = null;
    updates.reviewedAt = null;
    updates.reviewedBy = null;
  }

  await db
    .update(strategies)
    .set(updates)
    .where(eq(strategies.id, strategyId));

  if (requeueForReview && strategyType === "algo") {
    // Match marketplace PATCH: disabling the webhook forces a fresh test
    // signal before resubmission, which the studio checklist will surface.
    await db
      .update(copyWebhookConfig)
      .set({ enabled: false })
      .where(eq(copyWebhookConfig.strategyId, strategyId));
  }

  return {
    ok: true,
    payload: validation.value,
    meta,
    requeueForReview,
  };
}

export async function clearBacktestUpload(strategyId: string): Promise<void> {
  await db
    .update(strategies)
    .set({
      backtestUploadKind: null,
      backtestUploadPayload: null,
      backtestUploadMeta: null,
    })
    .where(eq(strategies.id, strategyId));
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
