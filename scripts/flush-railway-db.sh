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
# Ways to provide DATABASE_URL (first match wins):
#   1) Already set in the environment (e.g. export before running) — **takes precedence**
#   2) Else: `scripts/.railway-db-url` (gitignored), first non-comment line. See
#      scripts/.railway-db-url.example
#
# Usage:
#   bash scripts/flush-railway-db.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_URL_FILE="$ROOT/scripts/.railway-db-url"

# Do not let a stale gitignored file override a URL you just exported in the shell.
if [[ -z "${DATABASE_URL:-}" && -f "$LOCAL_URL_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == export\ DATABASE_URL=* ]]; then
      DATABASE_URL="${line#export DATABASE_URL=}"
    elif [[ "$line" == DATABASE_URL=* ]]; then
      DATABASE_URL="${line#DATABASE_URL=}"
    else
      DATABASE_URL="$line"
    fi
    DATABASE_URL="${DATABASE_URL#\'}"
    DATABASE_URL="${DATABASE_URL%\'}"
    DATABASE_URL="${DATABASE_URL#\"}"
    DATABASE_URL="${DATABASE_URL%\"}"
    break
  done <"$LOCAL_URL_FILE"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo "  export DATABASE_URL='postgresql://…'" >&2
  echo "  or put the raw URL on the first non-comment line in $LOCAL_URL_FILE" >&2
  exit 1
fi

export DATABASE_URL

if ! node -e "
const u = process.env.DATABASE_URL || '';
try {
  const x = new URL(u.replace(/^postgres:/i, 'postgresql:'));
  if (!x.hostname) throw new Error('missing host');
  process.exit(0);
} catch (e) {
  console.error('DATABASE_URL is not a valid URL for this check.');
  console.error('');
  console.error('Common mistake: the port must be digits (usually 5432), not the word PORT from a copy-pasted example.');
  console.error('Use your real Railway string: Dashboard → Postgres → Variables (DATABASE_PUBLIC_URL) or Connect.');
  console.error('From a Mac, do not use postgres.railway.internal unless you use a tunnel.');
  console.error('If the password has @ # % etc., URL-encode those characters.');
  process.exit(1);
}
"; then
  exit 1
fi

cd "$ROOT/backend"

echo "→ Running db:flush (host only, no password shown):"
node -e "
const u = process.env.DATABASE_URL || '';
const x = new URL(u.replace(/^postgres:/i, 'postgresql:'));
console.log('   ', x.hostname + ':' + (x.port || '5432'));
"

REXALGO_CONFIRM_FLUSH_ALL_APP_DATA=yes npm run db:flush

echo "✓ Done. Have testers sign out and sign in with Google again."
