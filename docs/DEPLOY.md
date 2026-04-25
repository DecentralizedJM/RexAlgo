# Deploying RexAlgo (Railway, Vercel, Docker)

> Going to production or scaling past a single API instance? Read
> [`PROD.md`](./PROD.md) for the current environment-variable set (Postgres,
> `ADMIN_EMAILS`, `PUBLIC_API_URL`, Telegram), the scaling checklist
> (1k → 10k CCU), and runbooks for secret rotation. This doc focuses on
> **topology**; PROD covers **operations**.

RexAlgo is a **Vite SPA** + **Next.js API** + **Postgres**. The browser calls **relative** `/api/*` with cookies (`Path=/api`, `SameSite=Lax`). That means:

- **Best UX**: One **browser** origin for the UI **and** `/api` (nginx, or **Vercel rewrites** to Railway), so session cookies stay on that host (`Path=/api`, `SameSite=Lax`).
- **Direct cross-origin API** (browser calls `https://*.up.railway.app/api` from `https://your-vercel-domain`) **breaks cookie login** unless you add CORS + `SameSite=None; Secure` — **not** implemented here. **Vercel-only UI + Railway API is fine** when every `/api/*` request goes to your Vercel hostname and Vercel **proxies** to Railway (see Option B).

Below: recommended patterns that keep **same-origin `/api`**.

---

## Option A — Railway (recommended): two services + one public URL

1. **API service**
   - Source: this repo, branch **`main`** (no separate Railway-only branch).
   - **Easiest:** leave **Root Directory** empty — use repo-root [`railway.toml`](../railway.toml) + [`Dockerfile.api`](../Dockerfile.api) (Docker build, not Railpack).
   - **Or:** set **Root Directory** to **`backend`** and use `backend/Dockerfile` + [`backend/railway.toml`](../backend/railway.toml).
   - **Persistent volume**: mount a volume at **`/data`** so `REXALGO_DB_PATH=/data/rexalgo.db` survives redeploys.
   - **Variables** (minimum):
     - `JWT_SECRET` — long random string.
     - `ENCRYPTION_KEY` — strong secret (encrypts Mudrex + webhook secrets).
     - `NODE_ENV=production`
     - `PUBLIC_APP_URL` — **public base URL where `/api/webhooks/...` is reachable** (see below).
   - Railway will assign a public URL like `https://rexalgo-api-production.up.railway.app`.

2. **Web service** (nginx + static `dist`)
   - **Dockerfile path**: `frontend/Dockerfile`.
   - **Variable**:
     - `API_UPSTREAM` — full URL of the API service **including port if non-default**, e.g. `https://rexalgo-api-production.up.railway.app` (no trailing slash).
   - Expose HTTP (port 80). Attach your **custom domain** here if you want a clean URL.

3. **`PUBLIC_APP_URL`**
   - If users and bots hit **`https://your-domain.com/api/...`** through the **web** nginx proxy → set  
     `PUBLIC_APP_URL=https://your-domain.com`
   - If you expose the API service URL directly for webhooks → set it to that API URL instead (less common if the UI is on a different host without proxy).

4. **Health checks**
   - API: `GET /api/health` (JSON with `service: rexalgo-api`).

**Private networking (optional):** If Railway places both services on a private network, you can set `API_UPSTREAM` to the internal HTTP URL Railway shows for the API service instead of the public `https://…` URL.

---

## Option B — Vercel (static UI only) + Railway (API)

The browser only talks to **your Vercel hostname** (e.g. `https://rexalgo.xyz`). Vercel serves the Vite `dist` and **rewrites** `/api/:path*` to your Railway service. Cookies and `fetch("/api/...")` stay same-origin.

### 1. Railway (API)

- Connect the **GitHub repo at the monorepo root** (same as Option A): [`railway.toml`](../railway.toml) + [`Dockerfile.api`](../Dockerfile.api).
- Set **`PUBLIC_APP_URL`** (and **`PUBLIC_API_URL`** if you use it) to your **Vercel site URL** — the hostname users and webhooks use in production, e.g. `https://rexalgo.xyz` **with no trailing slash**. Do **not** set this to the raw `*.up.railway.app` URL if users never hit that host in the browser.

### 2. Vercel — pick **one** layout (both are valid)

| Vercel **Root Directory** | Config file used | Install / build (already in repo) |
|---------------------------|------------------|-------------------------------------|
| *(empty — repo root)*     | [`vercel.json`](../vercel.json) | `npm ci`, `npm run build -w @rexalgo/frontend`, output `frontend/dist` |
| `frontend`                | [`frontend/vercel.ts`](../frontend/vercel.ts) | `npm install`, `npm run build`, output `dist` |

**Important:** If Root Directory is **`frontend`**, Vercel **does not read** the repo-root `vercel.json`. [`frontend/vercel.ts`](../frontend/vercel.ts) emits **rewrites** + **headers** at build time; set **`API_UPSTREAM`** in Vercel (Preview + Production) to your Railway API origin, **no trailing slash** (same value you used to put in JSON).

**Important:** There is **no** `package-lock.json` inside `frontend/`. A Vercel **Install Command** of `npm ci` at `frontend/` will fail. [`frontend/vercel.ts`](../frontend/vercel.ts) uses **`npm install`**. The repo-root layout uses **`npm ci`** with the root lockfile.

### 3. Point `/api` at Railway

- **Root Directory = `frontend`:** set environment variable **`API_UPSTREAM`** (e.g. `https://rexalgo-production.up.railway.app`). [`frontend/vercel.ts`](../frontend/vercel.ts) proxies `/api/:path*` → `${API_UPSTREAM}/api/:path*`.
- **Root Directory = repo root:** edit [`vercel.json`](../vercel.json) `rewrites` destination, or add a root `vercel.ts` mirroring the frontend pattern.

If Railway’s public hostname changes, update **`API_UPSTREAM`** (frontend project) or the root `vercel.json` rewrite and redeploy Vercel.

### 4. Custom domain

Attach **`rexalgo.xyz`** (or your domain) to the **Vercel** project. DNS should point to Vercel, not Railway, for this layout.

### 5. Stale UI after deploy

Trigger a fresh deployment from `main`, hard-refresh or use a private window, and check Cloudflare (if any) is not caching HTML aggressively. The built `index.html` includes `<meta name="rexalgo-build" …>`; view source or the browser console line `[RexAlgo] UI build:` to confirm the new bundle.

**Caveat:** Vercel rewrites add cold-start / edge latency on `/api`; heavy trading traffic may prefer Option A (single region, nginx + API).

### Landing page ticker: `GET /api/market/linear-usdt-tickers` returns 404

That route lives on the **Next.js API** (`backend`). If logs show repeated 404s:

1. **Redeploy the API** from current `main` so the `app/api/market/linear-usdt-tickers` route is present.
2. **Same-origin `/api`**: Confirm nginx `location /api` or Vercel `rewrites` forwards to your API host (see `frontend/vercel.json` — update the Railway URL if the service moved).
3. **UI-only hosting** (no proxy): the browser will 404 on `/api/*`; the ticker falls back to WebSocket-only prices and **stops polling** after the first failed snapshot so logs are not spammed.

---

## Option C — Docker Compose (VPS / single VM)

Already documented in the root [README.md](../README.md#docker-full-stack):

```bash
cp .env.example .env
# edit secrets, optional PUBLIC_APP_URL, HOST_PORT
docker compose up --build -d
```

The **web** image defaults to `API_UPSTREAM=http://api:3000` (Compose service name). Override only if you change service names.

---

## Environment checklist

| Variable | Where | Purpose |
|----------|--------|---------|
| `JWT_SECRET` | API | Signs the `rexalgo_session` cookie (JWS wrapper around an opaque `sid`). Rotate ⇒ forced global sign-out. |
| `ENCRYPTION_KEY` | API | Encrypt Mudrex + webhook secrets at rest |
| `DATABASE_URL` | API | Postgres connection. Migrations run on boot; `user_sessions` is created by `0008_user_sessions`. |
| `REDIS_URL` | API (optional, recommended in prod) | Shared Redis for cross-instance state. Required once you run more than one API replica so the 120 req/min webhook rate limit is enforced globally instead of per process. |
| `PUBLIC_APP_URL` | API | Full webhook URLs in studio UIs (no trailing slash). **Vercel UI + Railway API:** set to your SPA origin (e.g. `https://rexalgo.xyz`) so Telegram OAuth redirects return to the same host the browser uses (fallback when `X-Forwarded-Host` is missing). |
| `API_UPSTREAM` | Web (nginx) | Full URL of Next API for `proxy_pass` |
| `NODE_ENV=production` | API | `Secure` cookies |
| `REXALGO_OHLC_API_BASE` | API (optional) | Internal base URL for historical candle fetches used by `POST /api/strategies/[id]/backtest` (default built-in). Operators only — not shown in product UI. |
| `TELEGRAM_BOT_TOKEN` | API (optional) | Enables the bot-first login button on `/auth` and `/settings` and DM notifications. Both `TELEGRAM_BOT_*` vars must be set for the button to render. |
| `TELEGRAM_BOT_USERNAME` | API (optional) | Bot username from BotFather, no leading `@`. Served by `GET /api/auth/telegram/config` to the SPA so the button can build the `t.me/<bot>?start=…` deep link. |
| `TELEGRAM_WEBHOOK_SECRET` | API (required if bot vars are set) | Shared secret validated against Telegram's `X-Telegram-Bot-Api-Secret-Token` header on every inbound webhook. Generate with `openssl rand -hex 32`, set on Railway, and pass to `setWebhook` via `scripts/set-telegram-webhook.sh`. |
| `REXALGO_SESSION_COOKIE_DOMAIN` | API (optional) | Override cookie `Domain` (e.g. `.rexalgo.xyz`). If unset, `PUBLIC_APP_URL`’s hostname is used so sessions survive **Vercel → Railway** proxying. |

---

## Telegram login + notifications

We use a **bot-first deep-link flow** — not the Login Widget — because the
widget strands users on "Please confirm access via Telegram" whenever they
haven't already started the bot. Flow summary:

1. Browser → `POST /api/auth/telegram/start` creates a short-lived token.
2. Browser opens `https://t.me/<bot>?start=rexalgo_<token>`.
3. User taps **START** → bot webhook `/api/telegram/webhook` claims the token,
   captures `chat_id`, upserts the user, and DMs a welcome message.
4. Browser's `GET /api/auth/telegram/poll?token=…` mints the session cookie.

Enabling in production (operator task):

1. **Create the bot in BotFather**
   - Open a chat with [`@BotFather`](https://t.me/BotFather).
   - Run `/newbot` (or reuse an existing one) and record the **bot token** +
     **bot username** (no leading `@`).
2. **Set env vars on the Next API service** (Railway only — not Vercel):
   - `TELEGRAM_BOT_TOKEN=<token from BotFather>`
   - `TELEGRAM_BOT_USERNAME=<bot username, no @>`
   - `TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)` — shared secret for the
     inbound webhook. Must match the value passed to `setWebhook` below.
   - `PUBLIC_APP_URL=https://rexalgo.xyz` (site origin, no trailing slash).
3. **Register the webhook with Telegram** (one-shot; rerun after token rotation):
   ```bash
   TELEGRAM_BOT_TOKEN=… \
   TELEGRAM_WEBHOOK_SECRET=… \
   bash scripts/set-telegram-webhook.sh https://api.rexalgo.xyz
   ```
   The script calls `setWebhook` with `secret_token`, then prints
   `getWebhookInfo` so you can eyeball `pending_update_count` and
   `last_error_message` (both should stay empty).
4. **Redeploy the API** so the new env is picked up.
   Fastest check — run from the repo:
   ```bash
   bash scripts/verify-telegram.sh                       # hits rexalgo.xyz
   TELEGRAM_BOT_TOKEN=… bash scripts/verify-telegram.sh  # also calls getMe
   ```
5. **Smoke test** (the script prints this same checklist)
   - **Standalone login**: in a private window open `https://rexalgo.xyz/auth`,
     tap **Continue with Telegram** → Telegram opens → tap **START** → the
     auth tab completes sign-in without ever stalling on the phone-confirm
     screen.
   - **Link from settings**: signed in, `https://rexalgo.xyz/settings` →
     Telegram card → **Connect Telegram (1 tap)** flips to `Linked as @…`.
   - **DM**: trigger an event that emits a notification (e.g. approving a
     master-access request) and confirm the outbox worker delivers a DM
     within ~5s. `telegram_connected=true` is set during `/start`, so this
     works on the first try without any "please start the bot" nudge.
6. **Debugging**
   - **API logs**: JSON lines prefixed with `[rexalgo:telegram]`. Key events:
     `bot_login_start` (POST /start), `bot_start_claimed` (webhook claimed a
     token), `bot_poll` (browser minted the session).
   - If `bot_login_start` never appears, the browser couldn't reach the API.
   - If `bot_start_claimed` never appears, `setWebhook` wasn't run (or the
     `TELEGRAM_WEBHOOK_SECRET` mismatch is rejecting deliveries — the route
     logs `bot_webhook_bad_secret` in that case).
7. **Rotating the bot token**: generate a new token in BotFather, update
   `TELEGRAM_BOT_TOKEN`, redeploy, and re-run `scripts/set-telegram-webhook.sh`.
   Existing `users.telegram_id` / `users.telegram_chat_id` rows stay valid.

---

## Webhooks (external bots)

Bots must `POST` to:

`{PUBLIC_APP_URL}/api/webhooks/copy-trading/{strategyId}`

So `PUBLIC_APP_URL` must be a URL that resolves to a path nginx (or Vercel rewrite) forwards to Next. Use **HTTPS** in production.

---

## Database on PaaS

RexAlgo uses **PostgreSQL** in production. On Railway, attach the API service to
Railway Postgres (or provide another managed Postgres URL) and set
`DATABASE_URL`.

Redis is recommended for shared rate limits and multi-instance production
behavior. Set `REDIS_URL` when the deployment has more than one API replica or
when you want rate-limit state shared across restarts.
