import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { isAdminUser } from "@/lib/adminAuth";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { db } from "@/lib/db";
import { masterAccessRequests } from "@/lib/schema";
import { escapeTelegramHtml, formatAdminUserLine } from "@/lib/adminCopy";

const MAX_NOTE = 1000;
const MAX_PHONE = 40;
const MIN_PHONE_DIGITS = 6;

/**
 * Permissive phone-number validation. Accepts local or international numbers
 * (digits, spaces, `+`, `-`, parentheses) with at least 6 digits so the team
 * has something dialable. We intentionally do not enforce E.164 because users
 * submit a wide variety of regional formats.
 */
function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PHONE) return null;
  if (!/^[+\d\s()\-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return trimmed;
}

/**
 * Submit a new master-studio access request.
 * Rejects if the user already has a `pending` or `approved` row (409).
 * Admins don't need to request access and get a 200 no-op.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isAdminUser(session.user)) {
    return NextResponse.json({
      ok: true,
      status: "approved",
      message: "Admins have master studio access implicitly.",
    });
  }

  let body: { note?: string; contactPhone?: string } = {};
  try {
    body = (await req.json()) as { note?: string; contactPhone?: string };
  } catch {
    /* body is optional — but contactPhone is required so we'll catch it below */
  }

  const contactPhone = normalisePhone(body.contactPhone);
  if (!contactPhone) {
    return NextResponse.json(
      {
        error:
          "A valid contact phone number is required (6+ digits; + - ( ) and spaces allowed).",
        code: "CONTACT_PHONE_REQUIRED",
      },
      { status: 400 }
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  const [existingApproved] = await db
    .select({ id: masterAccessRequests.id })
    .from(masterAccessRequests)
    .where(
      and(
        eq(masterAccessRequests.userId, session.user.id),
        eq(masterAccessRequests.status, "approved")
      )
    )
    .limit(1);
  if (existingApproved) {
    return NextResponse.json(
      { error: "You already have master studio access", status: "approved" },
      { status: 409 }
    );
  }

  const [existingPending] = await db
    .select({ id: masterAccessRequests.id })
    .from(masterAccessRequests)
    .where(
      and(
        eq(masterAccessRequests.userId, session.user.id),
        eq(masterAccessRequests.status, "pending")
      )
    )
    .limit(1);
  if (existingPending) {
    return NextResponse.json(
      {
        error: "A request is already pending review",
        status: "pending",
        requestId: existingPending.id,
      },
      { status: 409 }
    );
  }

  const id = uuidv4();
  await db.insert(masterAccessRequests).values({
    id,
    userId: session.user.id,
    status: "pending",
    note,
    contactPhone,
  });

  void queueAdminNotification({
    kind: "admin_master_access_requested",
    text:
      `🆕 <b>New Master Studio access request</b>\n\n` +
      `Requester: ${formatAdminUserLine(session.user)}\n` +
      `Phone: <code>${escapeTelegramHtml(contactPhone)}</code>\n` +
      `Request ID: <code>${id}</code>\n` +
      `Note: ${note ? escapeTelegramHtml(note) : "—"}\n\n` +
      `Use the buttons below to approve or reject directly from Telegram.`,
    telegram: {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `adm:master:approve:${id}` },
            { text: "Reject", callback_data: `adm:master:reject:${id}` },
          ],
        ],
      },
    },
    meta: { requestId: id, userId: session.user.id },
  });

  return NextResponse.json({ ok: true, status: "pending", requestId: id });
}
