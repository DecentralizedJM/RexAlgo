# Deploying RexAlgo (Railway, Vercel, Docker)

RexAlgo is a **Vite SPA** + **Next.js API** + **SQLite**. The browser calls **relative** `/api/*` with cookies (`Path=/api`, `SameSite=Lax`). That means:

- **Best UX**: One public origin for the UI **and** `/api` (nginx or a host rewrite), so sessions and webhooks work without cross-site cookie changes.
- **Split domains** (e.g. UI on `*.vercel.app`, API on `*.up.railway.app`) **break login** unless you add CORS + `SameSite=None; Secure` cookies and point the SPA at an absolute API URL — **not** implemented in this repo today.

Below: recommended patterns that keep **same-origin `/api`**.

---

## Option A — Railway (recommended): two services + one public URL

1. **API service**
   - Source: this repo.
   - **Dockerfile path**: `backend/Dockerfile` (or set root to `backend` and default Dockerfile).
   - **Persistent volume**: mount a volume at **`/data`** so `REXALGO_DB_PATH=/data/rexalgo.db` survives redeploys (matches `backend/Dockerfile`).
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

## Option B — Vercel (static UI) + Railway (API)

Use Vercel only for the **Vite build** and **rewrite** `/api` to Railway so the browser still sees a **single origin** (`https://your-app.vercel.app`).

1. Deploy the **API** on Railway as in Option A (or any host running the Next standalone server).
2. Create a **Vercel** project:
   - **Root directory**: `frontend`
   - **Framework**: Vite (or “Other”)
   - **Build command**: `npm run build`
   - **Output directory**: `dist`
3. Add rewrites (Dashboard → `vercel.json` or project settings). Example `frontend/vercel.json`:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR-RAILWAY-API.up.railway.app/api/:path*"
    }
  ]
}
```

Replace `YOUR-RAILWAY-API...` with your real API hostname.

4. Set **`PUBLIC_APP_URL`** on the API to **`https://your-app.vercel.app`** so Master / Strategy studio show webhook URLs that match what external bots can call (through Vercel → Railway).

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
