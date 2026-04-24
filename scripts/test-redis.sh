#!/usr/bin/env bash
# Ping Redis using REDIS_URL (or pass URL as first argument).
#
# Usage:
#   export REDIS_URL='redis://...'   # or rediss://...
#   ./scripts/test-redis.sh
#
#   ./scripts/test-redis.sh 'rediss://default:pwd@host:6379'
#
# Requires either `redis-cli` (brew install redis) or Node + workspace deps
# (`npm install` at repo root).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:-${REDIS_URL:-}}"

if [[ -z "$URL" ]]; then
  echo "Set REDIS_URL or pass the connection string as the first argument." >&2
  exit 1
fi

echo "→ Testing Redis (host only, no password shown):"
node -e "
const u = process.argv[1];
try {
  const x = new URL(u.replace(/^redis:/i, 'http:'));
  console.log('   ', x.hostname + ':' + (x.port || '6379'));
} catch { console.log('   (could not parse URL)'); }
" "$URL"

if command -v redis-cli >/dev/null 2>&1; then
  echo "→ Using redis-cli PING"
  # redis-cli understands redis:// and rediss://
  redis-cli -u "$URL" PING
  echo "OK — redis-cli got PONG (or equivalent)."
  exit 0
fi

echo "→ redis-cli not found; using Node (ioredis) from backend workspace"
cd "$ROOT/backend"
TEST_REDIS_URL="$URL" node -e "
const Redis = require('ioredis');
const url = process.env.TEST_REDIS_URL;
const tls = /^rediss:/i.test(url)
  ? { rejectUnauthorized: false }
  : undefined;
const r = new Redis(url, {
  connectTimeout: 8000,
  maxRetriesPerRequest: 1,
  tls,
});
r.ping()
  .then((p) => {
    console.log('OK — PING reply:', p);
    process.exit(0);
  })
  .catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
  })
  .finally(() => r.quit().catch(() => {}));
"
