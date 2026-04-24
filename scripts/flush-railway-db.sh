#!/usr/bin/env bash
# Flush all RexAlgo app data against Railway (or any) Postgres, then re-seed.
#
# Prerequisites:
#   - Repo root: run from anywhere via absolute path, or `cd` to repo root first.
#   - `DATABASE_URL` must be set (see below). **Never commit** real credentials.
#
# postgres.railway.internal resolves only **inside** Railway’s private network.
#   • From a **Railway shell** on your API (or Postgres) service: internal URL is fine.
#   • From your **laptop**: use the **public** connection string from the Railway
#     Postgres plugin (Variables / Connect), or `railway connect` / TCP proxy.
#
# Ways to provide DATABASE_URL:
#   1) export DATABASE_URL='postgresql://…'
#   2) Create `scripts/.railway-db-url` (gitignored) containing one line:
#        export DATABASE_URL='postgresql://…'
#      Copy from scripts/.railway-db-url.example
#
# Usage:
#   bash scripts/flush-railway-db.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_URL_FILE="$ROOT/scripts/.railway-db-url"

if [[ -f "$LOCAL_URL_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$LOCAL_URL_FILE"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo "  export DATABASE_URL='postgresql://…'" >&2
  echo "  or create $LOCAL_URL_FILE (see scripts/.railway-db-url.example)" >&2
  exit 1
fi

cd "$ROOT/backend"

echo "→ Running db:flush (host only, no password shown):"
node -e "
const u = process.env.DATABASE_URL || '';
try {
  const x = new URL(u.replace(/^postgres:/i, 'postgresql:'));
  console.log('   ', x.hostname + ':' + (x.port || '5432'));
} catch { console.log('   (could not parse URL)'); }
"

REXALGO_CONFIRM_FLUSH_ALL_APP_DATA=yes npm run db:flush

echo "✓ Done. Have testers sign out and sign in with Google again."
