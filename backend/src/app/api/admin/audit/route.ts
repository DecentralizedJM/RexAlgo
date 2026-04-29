import { NextRequest, NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import {
  adminAuditLog,
  masterAccessRequests,
  strategies,
  strategySlotExtensionRequests,
  users,
} from "@/lib/schema";

const AUDIT_WINDOW_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;

type ResolvedUser = {
  id: string;
  displayName: string;
  email: string | null;
};

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

function parseDetail(detailJson: string | null): unknown {
  if (!detailJson) return null;
  try {
    return JSON.parse(detailJson) as unknown;
  } catch {
    return { raw: detailJson };
  }
}

function userLabel(user: ResolvedUser | undefined, fallbackId: string): string {
  return user?.displayName || user?.email || fallbackId;
}

function userSecondary(user: ResolvedUser | undefined): string | undefined {
  return user?.email ?? undefined;
}

/**
 * Recent admin mutations (newest first, capped at 500 rows, paged 50 at a time).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const url = new URL(req.url);
  const pageSize = clampInt(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const maxWindowPages = Math.max(1, Math.ceil(AUDIT_WINDOW_SIZE / pageSize));
  const requestedPage = clampInt(url.searchParams.get("page"), 1, 1, maxWindowPages);

  const windowRows = await db
    .select()
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(AUDIT_WINDOW_SIZE);

  const total = windowRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const pageRows = windowRows.slice((page - 1) * pageSize, page * pageSize);

  const strategyIds = unique(
    pageRows.map((r) => (r.targetType === "strategy" ? r.targetId : null))
  );
  const masterRequestIds = unique(
    pageRows.map((r) =>
      r.targetType === "master_access_request" ? r.targetId : null
    )
  );
  const slotRequestIds = unique(
    pageRows.map((r) =>
      r.targetType === "strategy_slot_extension_request" ? r.targetId : null
    )
  );

  const strategyRows =
    strategyIds.length > 0
      ? await db
          .select({
            id: strategies.id,
            name: strategies.name,
            type: strategies.type,
            symbol: strategies.symbol,
            status: strategies.status,
          })
          .from(strategies)
          .where(inArray(strategies.id, strategyIds))
      : [];
  const strategyById = new Map(strategyRows.map((s) => [s.id, s]));

  const masterRows =
    masterRequestIds.length > 0
      ? await db
          .select({
            id: masterAccessRequests.id,
            userId: masterAccessRequests.userId,
            status: masterAccessRequests.status,
            contactPhone: masterAccessRequests.contactPhone,
          })
          .from(masterAccessRequests)
          .where(inArray(masterAccessRequests.id, masterRequestIds))
      : [];
  const masterById = new Map(masterRows.map((r) => [r.id, r]));

  const slotRows =
    slotRequestIds.length > 0
      ? await db
          .select({
            id: strategySlotExtensionRequests.id,
            userId: strategySlotExtensionRequests.userId,
            strategyType: strategySlotExtensionRequests.strategyType,
            requestedSlots: strategySlotExtensionRequests.requestedSlots,
            status: strategySlotExtensionRequests.status,
          })
          .from(strategySlotExtensionRequests)
          .where(inArray(strategySlotExtensionRequests.id, slotRequestIds))
      : [];
  const slotById = new Map(slotRows.map((r) => [r.id, r]));

  const userTargetIds = unique(
    pageRows.map((r) => (r.targetType === "user" ? r.targetId : null))
  );
  const allUserIds = unique([
    ...pageRows.map((r) => r.actorUserId),
    ...userTargetIds,
    ...masterRows.map((r) => r.userId),
    ...slotRows.map((r) => r.userId),
  ]);
  const userRows =
    allUserIds.length > 0
      ? await db
          .select({
            id: users.id,
            displayName: users.displayName,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, allUserIds))
      : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages,
    windowSize: AUDIT_WINDOW_SIZE,
    entries: pageRows.map((r) => {
      const actor = userById.get(r.actorUserId) ?? null;
      let target:
        | {
            type: string | null;
            id: string | null;
            label: string;
            secondary?: string;
            status?: string;
          }
        | null = null;

      if (r.targetType === "strategy" && r.targetId) {
        const strategy = strategyById.get(r.targetId);
        target = strategy
          ? {
              type: r.targetType,
              id: r.targetId,
              label: strategy.name,
              secondary: `${strategy.type} · ${strategy.symbol}`,
              status: strategy.status,
            }
          : {
              type: r.targetType,
              id: r.targetId,
              label: "Strategy",
              secondary: r.targetId,
            };
      } else if (r.targetType === "master_access_request" && r.targetId) {
        const req = masterById.get(r.targetId);
        const targetUser = req ? userById.get(req.userId) : undefined;
        target = req
          ? {
              type: r.targetType,
              id: r.targetId,
              label: userLabel(targetUser, req.userId),
              secondary: req.contactPhone
                ? `Phone: ${req.contactPhone}`
                : userSecondary(targetUser),
              status: req.status,
            }
          : {
              type: r.targetType,
              id: r.targetId,
              label: "Master access request",
              secondary: r.targetId,
            };
      } else if (r.targetType === "strategy_slot_extension_request" && r.targetId) {
        const req = slotById.get(r.targetId);
        const targetUser = req ? userById.get(req.userId) : undefined;
        target = req
          ? {
              type: r.targetType,
              id: r.targetId,
              label: `${req.requestedSlots} ${req.strategyType} slot${req.requestedSlots === 1 ? "" : "s"}`,
              secondary: userLabel(targetUser, req.userId),
              status: req.status,
            }
          : {
              type: r.targetType,
              id: r.targetId,
              label: "Strategy slot request",
              secondary: r.targetId,
            };
      } else if (r.targetType === "user" && r.targetId) {
        const targetUser = userById.get(r.targetId);
        target = {
          type: r.targetType,
          id: r.targetId,
          label: userLabel(targetUser, r.targetId),
          secondary: userSecondary(targetUser),
        };
      } else if (r.targetType || r.targetId) {
        target = {
          type: r.targetType,
          id: r.targetId,
          label: r.targetType ?? "Target",
          secondary: r.targetId ?? undefined,
        };
      }

      return {
        id: r.id,
        actorUserId: r.actorUserId,
        actor,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        target,
        detail: parseDetail(r.detailJson),
        createdAt: r.createdAt.toISOString(),
      };
    }),
  });
}
