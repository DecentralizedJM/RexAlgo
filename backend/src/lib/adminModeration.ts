import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { copyWebhookConfig, masterAccessRequests, strategies } from "@/lib/schema";
import { logAdminAudit } from "@/lib/adminAudit";
import { queueNotification } from "@/lib/notifications";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

export async function approveMasterAccessRequest(params: {
  requestId: string;
  reviewerUserId: string;
  reviewerLabel: string;
}) {
  const [existing] = await db
    .select()
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.id, params.requestId));
  if (!existing) return { ok: false as const, error: "Request not found" };
  if (existing.status !== "pending") {
    return { ok: false as const, error: `Request is already ${existing.status}` };
  }
  await db
    .update(masterAccessRequests)
    .set({
      status: "approved",
      reviewedBy: params.reviewerLabel,
      reviewedAt: new Date(),
    })
    .where(eq(masterAccessRequests.id, params.requestId));

  void queueNotification(existing.userId, {
    kind: "master_access_approved",
    text: "✅ <b>Master Studio access approved</b> — you can now publish strategies and copy-trading feeds.",
  });

  void logAdminAudit({
    actorUserId: params.reviewerUserId,
    action: "master_access.review.approve",
    targetType: "master_access_request",
    targetId: params.requestId,
    detail: {
      userId: existing.userId,
      nextStatus: "approved",
      via: "telegram",
    },
  });
  return { ok: true as const, userId: existing.userId };
}

export async function rejectMasterAccessRequest(params: {
  requestId: string;
  reviewerUserId: string;
  reviewerLabel: string;
  note?: string;
}) {
  const [existing] = await db
    .select()
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.id, params.requestId));
  if (!existing) return { ok: false as const, error: "Request not found" };
  if (existing.status !== "pending") {
    return { ok: false as const, error: `Request is already ${existing.status}` };
  }
  const note = params.note?.trim().slice(0, 1000) || existing.note;
  await db
    .update(masterAccessRequests)
    .set({
      status: "rejected",
      reviewedBy: params.reviewerLabel,
      reviewedAt: new Date(),
      note,
    })
    .where(eq(masterAccessRequests.id, params.requestId));

  void queueNotification(existing.userId, {
    kind: "master_access_rejected",
    text:
      "❌ <b>Master Studio access was not approved</b>" +
      (note ? `\nNote: ${note.slice(0, 400)}` : ""),
  });

  void logAdminAudit({
    actorUserId: params.reviewerUserId,
    action: "master_access.review.reject",
    targetType: "master_access_request",
    targetId: params.requestId,
    detail: {
      userId: existing.userId,
      nextStatus: "rejected",
      note,
      via: "telegram",
    },
  });
  return { ok: true as const, userId: existing.userId };
}

export async function approveStrategyReview(params: {
  strategyId: string;
  reviewerUserId: string;
}) {
  const [existing] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, params.strategyId));
  if (!existing) return { ok: false as const, error: "Strategy not found" };
  if (existing.status !== "pending") {
    return { ok: false as const, error: `Strategy is already ${existing.status}` };
  }

  await db
    .update(strategies)
    .set({
      status: "approved",
      rejectionReason: null,
      reviewedBy: params.reviewerUserId,
      reviewedAt: new Date(),
    })
    .where(eq(strategies.id, params.strategyId));

  void queueNotification(existing.creatorId, {
    kind: "strategy_approved",
    text: `✅ <b>${existing.name}</b> was approved. When the listing is active, subscribers can mirror signals; your webhook setup in the studio is unchanged.`,
  });

  void logAdminAudit({
    actorUserId: params.reviewerUserId,
    action: "strategy.review.approve",
    targetType: "strategy",
    targetId: params.strategyId,
    detail: {
      strategyName: existing.name,
      creatorId: existing.creatorId,
      via: "telegram",
    },
  });

  revalidatePublicStrategiesList();
  return { ok: true as const, creatorId: existing.creatorId, name: existing.name };
}

export async function rejectStrategyReview(params: {
  strategyId: string;
  reviewerUserId: string;
  reason?: string;
}) {
  const [existing] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, params.strategyId));
  if (!existing) return { ok: false as const, error: "Strategy not found" };
  if (existing.status !== "pending" && existing.status !== "on_hold") {
    return { ok: false as const, error: `Strategy is already ${existing.status}` };
  }

  const reason =
    params.reason?.trim().slice(0, 500) ??
    "Rejected from Telegram. Please review the listing and resubmit from the studio.";

  await db
    .update(strategies)
    .set({
      status: "rejected",
      rejectionReason: reason,
      reviewedBy: params.reviewerUserId,
      reviewedAt: new Date(),
    })
    .where(eq(strategies.id, params.strategyId));

  await db
    .update(copyWebhookConfig)
    .set({ enabled: false })
    .where(eq(copyWebhookConfig.strategyId, params.strategyId));

  void queueNotification(existing.creatorId, {
    kind: "strategy_rejected",
    text:
      `❌ <b>${existing.name}</b> was not approved.` +
      `\nReason: ${reason}` +
      `\nEdit the listing and resubmit for review from the studio.`,
  });

  void logAdminAudit({
    actorUserId: params.reviewerUserId,
    action: "strategy.review.reject",
    targetType: "strategy",
    targetId: params.strategyId,
    detail: {
      strategyName: existing.name,
      creatorId: existing.creatorId,
      reason,
      via: "telegram",
    },
  });

  revalidatePublicStrategiesList();
  return { ok: true as const, creatorId: existing.creatorId, name: existing.name };
}

