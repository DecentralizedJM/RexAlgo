/**
 * Best-effort audit trail for admin mutations. Never throws; failures are logged only.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/lib/schema";
import { logger } from "@/lib/logger";

export type AdminAuditInput = {
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
};

export async function logAdminAudit(input: AdminAuditInput): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      id: uuidv4(),
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      detailJson:
        input.detail !== undefined ? JSON.stringify(input.detail) : null,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), action: input.action },
      "[admin-audit] insert failed"
    );
  }
}
