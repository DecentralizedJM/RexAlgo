/**
 * Admin + master-studio access helpers.
 *
 * Admins are identified by the `ADMIN_EMAILS` env var (comma-separated).
 * No DB role — matching is done on the current session's verified email.
 *
 * Master Studio access is gated by an approval row in `master_access_requests`:
 *   status=`approved` → user may reach /marketplace/studio, /copy-trading/studio and their APIs
 *   status=`pending`  → may not reach studio; sees a "waiting for review" state
 *   status=`rejected` or no row → may submit a request
 *
 * Admins always have master access (implicit approval).
 */
import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AuthUser } from "@/types";
import { db } from "@/lib/db";
import { masterAccessRequests } from "@/lib/schema";

export type MasterAccessStatus = "none" | "pending" | "approved" | "rejected";

export type AdminSession = {
  user: AuthUser;
};

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * `true` if the session's email is in `ADMIN_EMAILS` (case-insensitive).
 * A session without an email is never admin.
 */
export function isAdminUser(user: Pick<AuthUser, "email"> | null | undefined): boolean {
  if (!user?.email) return false;
  const allow = parseAdminEmails();
  return allow.includes(user.email.toLowerCase());
}

/**
 * Get the user's current master-studio status.
 * Admins always return `approved` (implicit bypass; no DB row needed).
 */
export async function getMasterAccessStatus(
  user: Pick<AuthUser, "id" | "email">
): Promise<MasterAccessStatus> {
  if (isAdminUser(user)) return "approved";

  // Pick the most recently created request; `approved` > `pending` > `rejected` precedence
  // is implied by "latest wins" for a user. To be robust we query explicitly.
  const [approved] = await db
    .select({ id: masterAccessRequests.id })
    .from(masterAccessRequests)
    .where(
      and(
        eq(masterAccessRequests.userId, user.id),
        eq(masterAccessRequests.status, "approved")
      )
    )
    .limit(1);
  if (approved) return "approved";

  const [pending] = await db
    .select({ id: masterAccessRequests.id })
    .from(masterAccessRequests)
    .where(
      and(
        eq(masterAccessRequests.userId, user.id),
        eq(masterAccessRequests.status, "pending")
      )
    )
    .limit(1);
  if (pending) return "pending";

  const [latest] = await db
    .select({ status: masterAccessRequests.status })
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.userId, user.id))
    .orderBy(desc(masterAccessRequests.createdAt))
    .limit(1);
  if (latest?.status === "rejected") return "rejected";
  return "none";
}

/**
 * Guard for studio API routes. Returns `null` when the user has access,
 * or a `NextResponse` to return immediately when blocked.
 */
export async function blockIfNoMasterAccess(
  user: Pick<AuthUser, "id" | "email">
): Promise<NextResponse | null> {
  const status = await getMasterAccessStatus(user);
  if (status === "approved") return null;
  return NextResponse.json(
    {
      error: "Master studio access required",
      code: "MASTER_ACCESS_REQUIRED",
      status,
    },
    { status: 403 }
  );
}

/**
 * Guard for `/api/admin/*` routes. Returns `null` when the user is an admin,
 * or a `NextResponse` to return immediately.
 */
export function blockIfNotAdmin(
  user: Pick<AuthUser, "email"> | null | undefined
): NextResponse | null {
  if (isAdminUser(user ?? null)) return null;
  return NextResponse.json(
    { error: "Admin access required", code: "ADMIN_REQUIRED" },
    { status: 403 }
  );
}

/** Small helper to allow admin routes to avoid importing `inArray` directly. */
export const masterStatusFilters = {
  anyActive: (col: typeof masterAccessRequests.status) =>
    inArray(col, ["pending", "approved"] as const),
};
