#!/usr/bin/env bash
# Smoke-test Telegram operator setup after BotFather + Railway env vars are live.
# Usage (from repo root):
#   bash scripts/verify-telegram.sh                    # checks https://rexalgo.xyz
#   bash scripts/verify-telegram.sh https://staging... # checks a custom base URL
#
# Verifies:
#   1. /api/auth/telegram/config reports enabled:true with a bot username.
#   2. The bot username resolves to a live Telegram account (getMe) when
#      TELEGRAM_BOT_TOKEN is exported locally (optional).
#   3. The returned botUsername matches TELEGRAM_BOT_USERNAME locally (optional).
#
# What this cannot do:
#   - BotFather /setdomain (no public API; must be done in the Telegram app).
#   - The actual Login Widget handshake (requires a human Telegram session).
#   - Delivering a DM to a real user (requires that user to have started the bot).
set -euo pipefail

BASE_URL="${1:-https://rexalgo.xyz}"
CONFIG_URL="${BASE_URL%/}/api/auth/telegram/config"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

echo "→ GET $CONFIG_URL"
body="$(curl -fsS --max-time 10 "$CONFIG_URL")" || {
  echo "  failed to reach config endpoint; is the API deployed and the domain pointing to it?" >&2
  exit 1
}
echo "  response: $body"

enabled="$(printf '%s' "$body" | sed -n 's/.*"enabled"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p')"
bot_username="$(printf '%s' "$body" | sed -n 's/.*"botUsername"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ "$enabled" != "true" ]; then
  echo "✗ Telegram is NOT enabled in production." >&2
  echo "  Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME on the Railway API service and redeploy." >&2
  exit 2
fi
if [ -z "$bot_username" ]; then
  echo "✗ enabled:true but botUsername is empty — check TELEGRAM_BOT_USERNAME (no leading @)." >&2
  exit 2
fi
echo "✓ config endpoint reports enabled=true, botUsername=@$bot_username"

if [ -n "${TELEGRAM_BOT_USERNAME:-}" ] && [ "$TELEGRAM_BOT_USERNAME" != "$bot_username" ]; then
  echo "✗ local TELEGRAM_BOT_USERNAME ($TELEGRAM_BOT_USERNAME) does not match live config (@$bot_username)." >&2
  exit 2
fi

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "→ Telegram Bot API getMe"
  me="$(curl -fsS --max-time 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe")" || {
    echo "  getMe failed — token may be invalid or revoked." >&2
    exit 3
  }
  api_username="$(printf '%s' "$me" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "$api_username" ]; then
    echo "✗ getMe returned no username: $me" >&2
    exit 3
  fi
  if [ "$api_username" != "$bot_username" ]; then
    echo "✗ live bot @$api_username does not match deployed botUsername @$bot_username." >&2
    exit 3
  fi
  echo "✓ token validated against Telegram (matches @$api_username)"
else
  echo "ℹ TELEGRAM_BOT_TOKEN not exported locally — skipped getMe validation."
fi

cat <<'NEXT'

Remaining manual checks (cannot be automated):
  1. Open https://rexalgo.xyz/settings signed in → Telegram card → click "Login with Telegram" → card flips to "Linked as @…".
  2. In a private window, https://rexalgo.xyz/auth → Telegram button → completes login.
  3. Have a test user /start the bot once, then trigger a notification event (e.g. approve a master-access request) and confirm the DM arrives.
NEXT
