/**
 * GET /api/auth/telegram/config — public: exposes the bot username so the
 * frontend can mount the Telegram Login Widget. Returns `{ enabled: false }`
 * when the bot is not configured (local dev without credentials).
 */
import { NextResponse } from "next/server";
import { telegramBotConfigured, telegramBotUsername } from "@/lib/telegram";

export async function GET() {
  const username = telegramBotUsername();
  return NextResponse.json({
    enabled: telegramBotConfigured() && Boolean(username),
    botUsername: username || null,
  });
}
