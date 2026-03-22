# Vercel (frontend) + Railway (API)

## Why the app “does not work”

1. **Browser calls `/api/*` on the same host** (`rex-algo-frontend.vercel.app`). Vercel only serves static files unless you **rewrite** `/api` to your Railway API.
2. **Railway must run the Next API**, not the Vite dev server. Logs showing **`localhost:8080` / `0.0.0.0:8080`** mean **Vite** started (frontend dev). The API uses **port 3000** and **`node server.js`** (Docker) or **`next start`**.

## Fix Railway (API)

1. **Branch:** **`main`** (single source of truth for the whole repo). Do **not** use a separate deploy branch.
2. **Root Directory:** **`backend`** in the Railway service settings so the build uses [`backend/Dockerfile`](../backend/Dockerfile) and [`backend/railway.toml`](../backend/railway.toml) (Dockerfile builder + health check).
3. Do **not** deploy the monorepo root with the default Nixpacks “npm run dev” flow — that can start the wrong app.
4. Attach a **volume** on **`/data`** for SQLite (`REXALGO_DB_PATH=/data/rexalgo.db` is the default in the image).
5. Set variables: **`JWT_SECRET`**, **`ENCRYPTION_KEY`**, **`PUBLIC_APP_URL`** (see below).

If your Railway project was tied to the old **`backend-railway`** branch, switch the service to **`main`** and set **Root Directory** to **`backend`**, then redeploy.

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
