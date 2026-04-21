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
| `frontend`                | [`frontend/vercel.json`](../frontend/vercel.json) | `npm install`, `npm run build`, output `dist` |

**Important:** If Root Directory is **`frontend`**, Vercel **does not read** the repo-root `vercel.json`. Keep [`frontend/vercel.json`](../frontend/vercel.json) in sync with root for **rewrites** (Railway URL) and **headers**.

**Important:** There is **no** `package-lock.json` inside `frontend/`. A Vercel **Install Command** of `npm ci` at `frontend/` will fail. The checked-in `frontend/vercel.json` uses **`npm install`** for that case. The repo-root layout uses **`npm ci`** with the root lockfile.

### 3. Point `/api` at Railway

In whichever `vercel.json` applies to your project, the rewrite destination must be your live Railway URL, for example:

`https://rexalgo-production.up.railway.app/api/:path*`

If Railway changes the hostname after a redeploy, update **both** [`vercel.json`](../vercel.json) and [`frontend/vercel.json`](../frontend/vercel.json) and redeploy Vercel.

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
| `JWT_SECRET` | API | Session JWT signing |
| `ENCRYPTION_KEY` | API | Encrypt Mudrex + webhook secrets at rest |
| `PUBLIC_APP_URL` | API | Full webhook URLs in studio UIs (no trailing slash). **Vercel UI + Railway API:** set to your SPA origin (e.g. `https://rexalgo.xyz`) so Telegram OAuth redirects return to the same host the browser uses (fallback when `X-Forwarded-Host` is missing). |
| `REXALGO_DB_PATH` | API | SQLite path; use `/data/rexalgo.db` + volume on Railway |
| `API_UPSTREAM` | Web (nginx) | Full URL of Next API for `proxy_pass` |
| `NODE_ENV=production` | API | `Secure` cookies |
| `REXALGO_OHLC_API_BASE` | API (optional) | Internal base URL for historical candle fetches used by `POST /api/strategies/[id]/backtest` (default built-in). Operators only — not shown in product UI. |
| `TELEGRAM_BOT_TOKEN` | API (optional) | Enables Telegram Login Widget on `/auth` and `/settings` and DM notifications. Both `TELEGRAM_BOT_*` vars must be set for the widget to render. |
| `TELEGRAM_BOT_USERNAME` | API (optional) | Bot username from BotFather, no leading `@`. Served by `GET /api/auth/telegram/config` to the SPA so the widget can mount. |
| `REXALGO_SESSION_COOKIE_DOMAIN` | API (optional) | Override cookie `Domain` (e.g. `.rexalgo.xyz`). If unset, `PUBLIC_APP_URL`’s hostname is used so sessions survive **Vercel → Railway** proxying. |

---

## Telegram login + notifications

The flow is fully implemented (see [PROD.md § Telegram](./PROD.md#6-telegram)); enabling it is an operator task:

1. **Create the bot in BotFather**
   - Open a chat with [`@BotFather`](https://t.me/BotFather) on Telegram.
   - Run `/newbot` (or pick an existing one) and record the **bot token** and **bot username**.
2. **Attach the production domain to the bot** (required by Telegram for the Login Widget)
   - Still in BotFather: `/setdomain` → pick the bot → send the browser host users actually visit, e.g. `rexalgo.xyz`.
   - Do **not** use the Railway API host here. The widget verifies the hostname that loaded the page, which on this deployment is the Vercel / custom domain, not the API.
3. **Set env vars on the Next API service** (Railway only — not on Vercel) alongside `JWT_SECRET` / `ENCRYPTION_KEY`:
   - `TELEGRAM_BOT_TOKEN=<token from BotFather>`
   - `TELEGRAM_BOT_USERNAME=<bot username, no @>`
   - **`PUBLIC_APP_URL=https://rexalgo.xyz`** (or your real site origin, no trailing slash) if the API does not receive `X-Forwarded-Host` from the proxy. Otherwise OAuth `Location` headers can point at the Railway hostname and the flow appears “stuck”.
   - If `PUBLIC_APP_URL` **must** stay as your API base for webhooks, set **`REXALGO_PUBLIC_BROWSER_ORIGIN=https://rexalgo.xyz`** (SPA only) so Telegram redirects still use the site origin.
4. **Redeploy the API** so the new env is picked up. `GET https://rexalgo.xyz/api/auth/telegram/config` should return `{ "enabled": true, "botUsername": "…" }`.
   Fastest check — run from the repo:
   ```bash
   bash scripts/verify-telegram.sh                       # hits rexalgo.xyz
   TELEGRAM_BOT_TOKEN=… bash scripts/verify-telegram.sh  # also calls getMe to validate the token
   ```
5. **Smoke test** (the script prints this same checklist)
   - **Link from settings**: sign in, open `https://rexalgo.xyz/settings`, the Telegram card should show the Login Widget. Linking should refetch `/api/auth/me` and show `Linked as @…`.
   - **Standalone login**: in a private window, `https://rexalgo.xyz/auth` should show the Telegram button. Completing it must sign you in (creates a Telegram-backed user on first use).
   - **DM**: trigger an event that emits a notification (e.g. approving a master-access request) and confirm the outbox worker delivers a DM within ~5s. The user must have **started the bot** at least once (Telegram won't accept DMs otherwise).
6. **Debugging a stuck widget** (after confirming in the Telegram app)
   - **API (Railway logs only in production):** JSON lines prefixed with `[rexalgo:telegram]` are emitted when `RAILWAY_ENVIRONMENT` is set (Railway’s default). Local `NODE_ENV=development` always logs. Set **`REXALGO_TELEGRAM_TRACE=1` on Railway** if you need logs on another host or extra fields. After confirmation you should see `get_enter` (check **`redirectOrigin`** vs **`nextOrigin`** — they should match your public site) → `oauth_in` → `oauth_verify_ok` (or `oauth_verify_failed` with `reason`) → `get_redirect`. If **`get_enter` never appears**, the browser never hit your API.
   - **Optional:** keep `REXALGO_TELEGRAM_TRACE=1` on Railway only to also log Telegram `telegramUserId` and `auth_date` after a successful hash check (disable when finished).
   - **Browser:** open `https://rexalgo.xyz/auth?telegram_debug=1` (or `localStorage.setItem("rexalgoDebugTelegram","1")` then reload). The console logs the exact `data-auth-url`. In **Network**, watch for `GET /api/auth/telegram?...` after you tap confirm in Telegram.
7. **Rotating the bot token** (if ever needed): see [PROD.md § Secret rotation](./PROD.md#8-secret-rotation-runbook). Existing `users.telegram_id` rows stay valid.

---

## Webhooks (external bots)

Bots must `POST` to:

`{PUBLIC_APP_URL}/api/webhooks/copy-trading/{strategyId}`

So `PUBLIC_APP_URL` must be a URL that resolves to a path nginx (or Vercel rewrite) forwards to Next. Use **HTTPS** in production.

---

## SQLite on PaaS

Without a **persistent volume**, SQLite is wiped on each deploy. Configure Railway’s volume for `/data` (or set `REXALGO_DB_PATH` to that mount path).

For multi-instance horizontal scaling, SQLite is a poor fit; you’d migrate to Postgres later.
