import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isAdminUser } from "@/lib/adminAuth";
import { queueNotification, type NotificationPayload } from "@/lib/notifications";
import { sendTelegramMessage } from "@/lib/telegram";
import { users } from "@/lib/schema";

type AdminRecipient = {
  id: string;
  telegramChatId: string | null;
};

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parseAdminTelegramChatIds(): string[] {
  const raw = process.env.ADMIN_TELEGRAM_CHAT_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function fetchAdminRecipients(): Promise<AdminRecipient[]> {
  const emails = parseAdminEmails();
  if (emails.length === 0) return [];
  const rows = await db
    .select({ id: users.id, telegramChatId: users.telegramChatId })
    .from(users)
    .where(sql`lower(${users.email}) = ANY(${emails})`);
  return rows;
}

export async function queueAdminNotification(
  payload: NotificationPayload
): Promise<void> {
  const recipients = await fetchAdminRecipients();
  const connectedChats = new Set(
    recipients.map((r) => r.telegramChatId).filter((v): v is string => Boolean(v))
  );
  await Promise.all(
    recipients.map((r) => queueNotification(r.id, payload))
  );

  // Optional direct fan-out path for ops teams: lets admins receive alerts even
  // before linking Telegram inside RexAlgo user settings.
  const extraChatIds = parseAdminTelegramChatIds().filter(
    (chatId) => !connectedChats.has(chatId)
  );
  await Promise.all(
    extraChatIds.map((chatId) =>
      sendTelegramMessage(chatId, payload.text, {
        parseMode: "HTML",
        replyMarkup: payload.telegram?.replyMarkup,
      })
    )
  );
}

export function isAdminTelegramUserEmail(email: string | null | undefined): boolean {
  return isAdminUser(email ? { email } : null);
}

