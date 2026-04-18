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
| `PUBLIC_APP_URL` | API | Full webhook URLs in studio UIs (no trailing slash) |
| `REXALGO_DB_PATH` | API | SQLite path; use `/data/rexalgo.db` + volume on Railway |
| `API_UPSTREAM` | Web (nginx) | Full URL of Next API for `proxy_pass` |
| `NODE_ENV=production` | API | `Secure` cookies |
| `REXALGO_OHLC_API_BASE` | API (optional) | Internal base URL for historical candle fetches used by `POST /api/strategies/[id]/backtest` (default built-in). Operators only — not shown in product UI. |

---

## Webhooks (external bots)

Bots must `POST` to:

`{PUBLIC_APP_URL}/api/webhooks/copy-trading/{strategyId}`

So `PUBLIC_APP_URL` must be a URL that resolves to a path nginx (or Vercel rewrite) forwards to Next. Use **HTTPS** in production.

---

## SQLite on PaaS

Without a **persistent volume**, SQLite is wiped on each deploy. Configure Railway’s volume for `/data` (or set `REXALGO_DB_PATH` to that mount path).

For multi-instance horizontal scaling, SQLite is a poor fit; you’d migrate to Postgres later.
