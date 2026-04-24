#!/usr/bin/env bash
# Register RexAlgo's Telegram bot webhook against the Bot API.
#
# Usage (from repo root):
#   TELEGRAM_BOT_TOKEN=12345:abc \
#   TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
#   bash scripts/set-telegram-webhook.sh https://api.rexalgo.xyz
#
# What it does:
#   1. POSTs `setWebhook` with `url=<BASE>/api/telegram/webhook` and the shared
#      `secret_token` so Telegram adds `X-Telegram-Bot-Api-Secret-Token` to
#      every delivery (validated in `src/app/api/telegram/webhook/route.ts`).
#   2. Tells Telegram to drop any pending updates from a previous dev bot
#      owner (`drop_pending_updates=true`).
#   3. Restricts updates to `message` + `edited_message` — enough for `/start`
#      handling; keeps our ingress small.
#   4. Prints `getWebhookInfo` afterwards so you can eyeball `pending_update_count`
#      and `last_error_message`.
#
# Both env vars MUST match the values running on the API (Railway):
#   TELEGRAM_BOT_TOKEN
#   TELEGRAM_WEBHOOK_SECRET
set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "usage: bash scripts/set-telegram-webhook.sh https://api.rexalgo.xyz" >&2
  exit 2
fi
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN not set" >&2
  exit 2
fi
if [ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]; then
  echo "TELEGRAM_WEBHOOK_SECRET not set (generate with: openssl rand -hex 32)" >&2
  exit 2
fi

WEBHOOK_URL="${BASE_URL%/}/api/telegram/webhook"

echo "→ setWebhook $WEBHOOK_URL"
resp="$(curl -fsS --max-time 15 -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WEBHOOK_URL}" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'drop_pending_updates=true' \
  --data-urlencode 'allowed_updates=["message","edited_message"]')"
echo "  $resp"

echo "→ getWebhookInfo"
curl -fsS --max-time 10 \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo

echo "Done. Now sign in to RexAlgo and tap 'Continue with Telegram'."
