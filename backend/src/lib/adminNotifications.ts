import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isAdminUser } from "@/lib/adminAuth";
import { queueNotification, type NotificationPayload } from "@/lib/notifications";
import { users } from "@/lib/schema";

type AdminRecipient = { id: string };

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

async function fetchAdminRecipients(): Promise<AdminRecipient[]> {
  const emails = parseAdminEmails();
  if (emails.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ANY(${emails})`);
  return rows;
}

export async function queueAdminNotification(
  payload: NotificationPayload
): Promise<void> {
  const recipients = await fetchAdminRecipients();
  await Promise.all(
    recipients.map((r) => queueNotification(r.id, payload))
  );
}

export function isAdminTelegramUserEmail(email: string | null | undefined): boolean {
  return isAdminUser(email ? { email } : null);
}

