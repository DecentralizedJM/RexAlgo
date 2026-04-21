# Production operations (Postgres + scale + integrations)

Companion to [`DEPLOY.md`](./DEPLOY.md). The deploy doc covers topology; this
one covers everything you need to run RexAlgo at **1k–10k concurrent users**
with the stack as it stands today (Postgres, admin dashboard, Master Studio
lock, TradingView webhooks, Telegram login/notifications).

If you're looking for the "where does the DB live" / "who is an admin" answer,
this is the file.

---

## 1. Environment variables

All vars live on the **API service** unless noted. The backend will fail fast
with a clear error if any required one is missing.

### Required

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgres://user:pass@host:5432/rexalgo?sslmode=require` | Postgres connection (Railway/Neon/Supabase all work). Required in all envs. |
| `JWT_SECRET` | 64-char random | Session JWT signing. Rotate ⇒ forces relogin. |
| `ENCRYPTION_KEY` | 32+ char random | AES-GCM key for Mudrex + webhook secrets. **Rotate ⇒ all secrets unreadable** — plan a migration first. |
| `NODE_ENV` | `production` | Turns on `Secure` cookies + SSL preference. |

### Strongly recommended

| Variable | Example | Purpose |
|----------|---------|---------|
| `PUBLIC_API_URL` | `https://api.rexalgo.xyz` | Canonical base for **all** webhook URLs shown in the UI (copy-trade + TradingView). If unset we fall back to legacy `PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_URL`. Prefer the dedicated API hostname — it survives frontend-host changes. |
| `ADMIN_EMAILS` | `jm@rexalgo.xyz,admin@rexalgo.xyz` | Comma-separated allow-list. Used by `/api/admin/*` and to surface the Admin button in the navbar. Case-insensitive match on the Google email. |
| `PGPOOL_MAX` | `10` | Per-process Postgres pool size. Keep `PGPOOL_MAX * instance_count ≤ db.max_connections * 0.7`. |
| `PGSSLMODE` | `disable` | Force SSL off; handy for private-network Postgres. Any other value = SSL with `rejectUnauthorized: false`. |

### Telegram (optional; enables login + DMs)

| Variable | Example | Purpose |
|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | from `@BotFather` | Used for HMAC-verifying the Login Widget and sending DMs. |
| `TELEGRAM_BOT_USERNAME` | `RexAlgoBot` | Used by the frontend to mount the Login Widget. Both vars must be set for the button to render. |
| `PUBLIC_APP_URL` | `https://rexalgo.xyz` | **SPA origin** (no trailing slash). When the API runs on Railway behind a CDN/proxy, OAuth redirects use `X-Forwarded-Host` first; if that header is absent, this value must be the site users open in the browser — otherwise `Location` after Telegram login can target the wrong host. |
| `REXALGO_PUBLIC_BROWSER_ORIGIN` | `https://rexalgo.xyz` | Optional override **first** for Telegram OAuth `Location` when `PUBLIC_APP_URL` is intentionally the **API** host (webhooks). Alias: `PUBLIC_BROWSER_ORIGIN`. |

If either is missing, the Telegram Login button silently disappears and the
notifications worker is a no-op.

**Railway-only (recommended):** set `REXALGO_TELEGRAM_TRACE=1` on the API service only when debugging; structured `[rexalgo:telegram]` logs already run on Railway in production by default.

### Session / cookies

| Variable | Default | Purpose |
|----------|---------|---------|
| `REXALGO_SESSION_MAX_AGE_DAYS` | `90` | Capped at 90 (Mudrex key lifetime). |
| `REXALGO_SESSION_COOKIE_PATH` | `/api` | Avoid using `/` so other apps on the same host don't see the session cookie. |
| `REXALGO_SESSION_COOKIE_DOMAIN` | `.rexalgo.xyz` | Optional. If unset and `PUBLIC_APP_URL` is your SPA origin, the API sets `Domain` on `rexalgo_session` so the cookie is stored for that host when responses are proxied (e.g. Vercel → Railway). |

### Internal knobs

| Variable | Default | Purpose |
|----------|---------|---------|
| `REXALGO_SKIP_DB_BOOT` | unset | Set to `1` only in the SQLite→Postgres migration script. Skips automatic migrations + seed on boot. |
| `REXALGO_DISABLE_NOTIFICATIONS` | unset | Set to `1` in tests to prevent the outbox worker from ticking. |

---

## 2. Postgres

### Hosting

- **Production:** Railway Postgres (or Neon/Supabase — any managed PG16+).
- **Local dev:** `docker compose -f docker-compose.dev.yml up -d`.

### Connection sizing

Per Next API process: one `pg.Pool` with `max = PGPOOL_MAX` (default `10`).
Every horizontally-scaled instance holds its own pool, so if you run four API
instances at `PGPOOL_MAX=10`, Postgres must accept ≥ 40 client connections
simultaneously. Add 30–40% headroom for migrations, admin psql sessions, and
pg_dumps.

### Migrations

Drizzle migrations live in `backend/drizzle/*.sql`. On every boot the API:

1. Opens `pg.Pool`.
2. Runs `drizzle-orm/node-postgres/migrator.migrate()` from `backend/drizzle/`.
3. Seeds demo strategies only if the `strategies` table is empty.

Applying migrations manually (useful for pre-deploy smoke tests):

```bash
cd backend
DATABASE_URL=postgres://... npm run db:migrate
```

### Backups

Railway takes nightly snapshots automatically. For higher RPO:

- Enable Railway's point-in-time recovery, **or**
- Schedule a daily `pg_dump` to S3/R2 with a 14-day retention.

Test restore quarterly into a staging database.

### Data hygiene

- `copy_signal_events` / `tv_webhook_events` / `copy_mirror_attempts` grow
  unbounded. Add a monthly `DELETE WHERE created_at < now() - interval '90 days'`
  cron once volumes warrant it (not worth it pre-100 strategies).
- `notifications_outbox` naturally stays small (rows flip to `sent`/`failed`/`skipped`).

---

## 3. Admin dashboard

`https://<host>/admin` is gated on `ADMIN_EMAILS`. The dashboard can:

- Approve/reject Master Studio access requests.
- Toggle `is_active` on any strategy.
- Hard-delete strategies (ON DELETE CASCADE to webhooks, events, subscriptions).
- List users (with strategy counts + master-access status).

**Important:** there is no "soft delete". Deleting a strategy removes its
webhook config (so the external bot will start getting 403s) and event history.
An admin delete also enqueues a Telegram DM to the owner (if linked).

---

## 4. Master Studio lock

Two places enforce the lock:

- **Server:** `blockIfNoMasterAccess()` in `backend/src/lib/adminAuth.ts` is
  imported by every studio route.
- **Client:** `useRequireMasterAccess()` redirects to `/master-studio/request`
  if `session.masterAccess !== "approved"` and the user isn't an admin.

Admins bypass both checks. The request flow inserts a `pending` row into
`master_access_requests`; the admin dashboard flips it to `approved`/`rejected`
and queues a Telegram notification.

---

## 5. Webhooks (copy + TradingView)

### URL shape

| Kind | Shape |
|------|-------|
| Copy-trade | `{PUBLIC_API_URL}/api/webhooks/copy-trading/{strategyId}` |
| TradingView | `{PUBLIC_API_URL}/api/webhooks/tv/{webhookId}` |

Always prefer `PUBLIC_API_URL` over `PUBLIC_APP_URL` — the studio UI shows
whatever `publicApiBase()` returns, so your users copy the right host into
their alert configs.

### Signing

Both endpoints use the same `X-RexAlgo-Signature: t=<unix>,v1=<hmac>` scheme
(`backend/src/lib/copyWebhookHmac.ts`). The signed payload is
`${t}.${rawBody}`; we allow a ±5 minute skew.

Secrets are prefixed `whsec_` and stored AES-GCM-encrypted with `ENCRYPTION_KEY`.
`POST /rotate` issues a new one; the old one becomes invalid immediately.

### Rate limiting

`backend/src/lib/copyWebhookRateLimit.ts` is an **in-memory fixed window** —
120 req/min per strategy (or `tv:<id>` for TradingView webhooks). **TODO (scaling):** replace
with a Redis-backed bucket once you horizontally scale past one API instance,
or abusive clients will get `120 * N` through collectively.

### Idempotency

- Copy-trade: unique `(strategy_id, idempotency_key)` on `copy_signal_events`.
- TradingView: unique `(webhook_id, idempotency_key)` on `tv_webhook_events`.

Duplicates return `200 { ok: true, duplicate: true }` — TradingView's at-least-once
retries are harmless.

### TradingView alert adapter

`backend/src/lib/tvAlert.ts` accepts either:

1. Our native copy-signal envelope (same schema as the copy-trade webhook), or
2. A simple `{ action, symbol, leverage?, sl?, tp?, qty?, risk_pct? }` template for manual trades.

`action` accepts `buy`, `sell`, `long`, `short`, `close`, `exit`,
`close_long`, `close_short`. Optional `id` / `idempotency_key` in the JSON; if
omitted, dedupe uses a stable hash of the raw body. `qty: "25 USDT"` is clamped to
`tv_webhooks.max_margin_usdt`.

TradingView cannot attach custom HTTP headers, so users need a tiny forwarder
(Cloudflare Worker / Lambda / VM) that HMAC-signs the body before calling the
webhook. We document this on the TradingView Webhooks page.

---

## 6. Telegram

### Login

Telegram Login Widget posts to `/api/auth/telegram`:

1. If a session exists → links Telegram to that user.
2. Else if Telegram id is already known → signs in that user.
3. Else → creates a new `users` row with `auth_provider = 'telegram'`.

HMAC verification uses `TELEGRAM_BOT_TOKEN` (see
`backend/src/lib/telegram.ts`). The widget mounts only when
`/api/auth/telegram/config` reports `enabled: true`.

### Notifications

`backend/src/lib/notifications.ts` runs an in-process worker every 5s that
drains `notifications_outbox` rows where `status = 'queued'`. Events we emit
today:

- `master_access_approved` / `master_access_rejected`
- `strategy_deleted_by_admin`
- `tv_alert_executed` / `copy_mirror_error`

The worker is in-process (no Redis queue) — fine up to a few hundred DMs/min.
At much higher volume, move the loop to a dedicated worker process and pull
rows with `SELECT ... FOR UPDATE SKIP LOCKED`.

**Hard failures** (blocked user, bot kicked) mark the row `failed` and stop
retrying; soft failures (5xx / network) retry up to 5 attempts.

---

## 7. Scaling checklist (1k → 10k concurrent users)

Everything is fine at 1k CCU with a single API instance and a small Postgres.
Below are the changes you'll want as you climb toward 10k CCU.

### Must-do

- [ ] **Horizontal API scaling.** Deploy ≥ 2 API instances behind a load balancer.
      Sessions are JWT so this Just Works.
- [ ] **Replace in-memory rate limiter with Redis.** See
      `backend/src/lib/copyWebhookRateLimit.ts`. Use a Redis atomic counter
      (`INCR` + `PEXPIRE`) or the official `@upstash/ratelimit`.
- [ ] **Mudrex circuit breaker.** Wrap `backend/src/lib/mudrex.ts` calls in a
      circuit breaker (e.g. `opossum`) so a Mudrex outage doesn't saturate the
      event loop with hung promises. Emit `code: "MUDREX_UNAVAILABLE"` and
      degrade the dashboard gracefully.
- [ ] **Observability.** Wire a structured logger (`pino`) + OpenTelemetry to
      Datadog/Grafana. Minimum signals: request rate/latency per route,
      Postgres pool wait time, Mudrex error rate, `notifications_outbox` depth.
- [ ] **Alerts.** Page on: API 5xx ≥ 1%/5m, Postgres pool wait p95 ≥ 100ms,
      Mudrex error rate ≥ 10%/5m, outbox queued ≥ 500.

### Should-do

- [ ] **Move the notifications worker into a separate process** so the API
      nodes only serve HTTP. This also lets you scale the worker independently.
- [ ] **Stream-truncate event tables.** Cron the `copy_signal_events` /
      `tv_webhook_events` / `copy_mirror_attempts` retention once they grow
      past a few GB.
- [ ] **CDN in front of the SPA.** Static Vite build gets aggressive caching
      (immutable filenames). Only `/api/*` and `/index.html` need to hit the
      origin.
- [ ] **Migrate webhooks rate limit + idempotency cache to Redis** so retries
      across instances see the same state.

### Nice-to-have

- [ ] Per-user QPS quota on `/api/market/*` to stop dashboard polling storms
      from drowning the Postgres connections.
- [ ] Background job to pre-compute leaderboard stats so `/api/marketplace`
      isn't a live aggregate query.
- [ ] `pgbouncer` (transaction pooling) in front of Postgres when you scale
      past ~6 API instances.

---

## 8. Secret rotation runbook

All of these require a short read-only window (≤ 30s) for safety.

### `JWT_SECRET`

1. Set new value, redeploy.
2. All users get a one-time relogin prompt. No data loss.

### `ENCRYPTION_KEY`

**Destructive** — invalidates every Mudrex key and webhook secret on the
platform.

1. Export a CSV of affected users (`SELECT id, email FROM users WHERE api_secret_encrypted IS NOT NULL`).
2. Set new value, redeploy.
3. Rotate every impacted webhook (`POST /api/.../webhook` with `action: rotate`).
4. Ask users to re-link Mudrex.

Prefer to never rotate this in prod. Generate 32+ random bytes once and store
in a password manager.

### `TELEGRAM_BOT_TOKEN`

1. Revoke in `@BotFather`, create a new bot if necessary.
2. Set new `TELEGRAM_BOT_TOKEN` (and `TELEGRAM_BOT_USERNAME` if you swapped
   bots). Redeploy.
3. Existing `users.telegram_id` rows remain valid — they're per-user, not
   per-bot.

---

## 9. Incident playbook (quick)

| Symptom | First check |
|---------|-------------|
| Users cannot log in | `/api/auth/me` returns 401 repeatedly? Check `JWT_SECRET` didn't change; inspect cookie domain/path. |
| Webhook 401s (valid client) | `ENCRYPTION_KEY` didn't change? Secret expected `whsec_` prefix. |
| Webhook 403 `Webhook disabled` | Check `copy_webhook_config.enabled` / `tv_webhooks.enabled`. |
| Mudrex "API key invalid" spam | User must rotate in Mudrex + re-auth; see `isMudrexCredentialError`. |
| Telegram DMs stuck `queued` | Bot blocked by user (hard fail), or rate limited. Check `last_error`. |
| DB connection spikes | `PGPOOL_MAX * instances` approaching Postgres `max_connections`. Lower pool or upsize. |

---

## 10. Local dev tips

```bash
# 1. Start Postgres
docker compose -f docker-compose.dev.yml up -d

# 2. Configure env
cp backend/.env.example backend/.env.local
# edit DATABASE_URL, optionally ADMIN_EMAILS, TELEGRAM_*

# 3. Apply migrations + boot API
cd backend && npm run db:migrate && npm run dev

# 4. Frontend
cd frontend && npm run dev
```

- `npm run db:studio` opens a drizzle-kit UI for poking at rows.
- `npm run db:import-sqlite` is the one-shot migration from the old SQLite db;
  it sets `REXALGO_SKIP_DB_BOOT=1` and then runs `migrate` inside the script.
- Set `REXALGO_DISABLE_NOTIFICATIONS=1` if you don't want the outbox worker
  hitting the Telegram API from your laptop.
