# Vercel (frontend) + Railway (API)

## Why the app “does not work”

1. **Browser calls `/api/*` on the same host** (`rex-algo-frontend.vercel.app`). Vercel only serves static files unless you **rewrite** `/api` to your Railway API.
2. **Railway must run the Next API**, not the Vite dev server. Logs showing **`localhost:8080` / `0.0.0.0:8080`** mean **Vite** started (frontend dev). The API uses **port 3000** and **`node server.js`** (Docker) or **`next start`**.

## Fix Railway (API)

1. **Branch:** **`main`** (single source of truth for the whole repo).
2. **Recommended:** leave **Root Directory empty** (repo root). The repo includes **[`railway.toml`](../railway.toml)** + **[`Dockerfile.api`](../Dockerfile.api)** so Railway uses **Docker**, not Railpack — no workspace/start-command guessing.
3. **Alternative:** set **Root Directory** to **`backend`** — then Railway uses [`backend/Dockerfile`](../backend/Dockerfile) and [`backend/railway.toml`](../backend/railway.toml).
4. Do **not** rely on Railpack at the monorepo root without one of the above — it will not find a single-package start command.
5. Attach a **volume** on **`/data`** for SQLite (`REXALGO_DB_PATH=/data/rexalgo.db` is the default in the image).
6. Set variables: **`JWT_SECRET`**, **`ENCRYPTION_KEY`**, **`PUBLIC_APP_URL`** (see below).

If your Railway project was tied to the old **`backend-railway`** branch, switch the service to **`main`**, clear **Root Directory** (or set it to **`backend`** as above), then redeploy.

## Fix Vercel (frontend)

1. The repo includes **`frontend/vercel.json`**, which:
   - Proxies **`/api/*`** → Railway (`https://rexalgo-production.up.railway.app` — **edit this** if your API host changes).
   - Rewrites other paths to **`/index.html`** so React Router deep links don’t return Vercel **404 NOT_FOUND** on refresh.

   Or set the same rules under **Vercel → Project → Settings → Rewrites**.

2. **Root Directory** for the Vercel project must be **`frontend`** so `vercel.json` is picked up. Commit/push so Vercel redeploys.
3. In **Railway → Variables**, set  
   **`PUBLIC_APP_URL=https://rex-algo-frontend.vercel.app`**  
   so Master/Strategy studio show webhook URLs that hit Vercel → rewrite → Railway.

## Quick checks

```bash
curl -sS https://rexalgo-production.up.railway.app/api/health
curl -sS https://rex-algo-frontend.vercel.app/api/health
```

Both should return JSON including `"service":"rexalgo-api"`.

## References

- [Vercel rewrites](https://vercel.com/docs/projects/project-configuration#rewrites)
- [Railway Docker deploy](https://docs.railway.com/guides/dockerfiles)
