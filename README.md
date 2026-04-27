# RexAlgo

**RexAlgo** is a full-stack platform for **algorithmic strategies** and **copy trading**, built on the [**Mudrex Futures API**](https://docs.trade.mudrex.com/docs/overview). It pairs a **Vite + React** UI (shadcn, Tailwind) with a **Next.js** API, **PostgreSQL** (Drizzle), optional **Redis** (distributed limits), and **Docker**-ready deployment.

> **Source-available, not open source:** RexAlgo is proprietary software. You may not use, copy, fork, modify, deploy, or redistribute this repository without written consent from DecentralizedJM. See [LICENSE](LICENSE).

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#repository-layout">Layout</a> ·
  <a href="#diagram-index">Diagrams</a> ·
  <a href="#quick-start-localhost">Quick start</a> ·
  <a href="#development">Development</a> ·
  <a href="#authentication--sessions">Auth & sessions</a> ·
  <a href="#webhooks--external-signals">Webhooks</a> ·
  <a href="#hosting-railway-and-vercel">Hosting</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#docker-full-stack">Docker</a> ·
  <a href="#scripts">Scripts</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#policies--links">Policies</a> ·
  <a href="#changelog">Changelog</a>
</p>

---

## Features

| Area | What you get |
|------|----------------|
| **Identity** | **Google OAuth** at `/auth` (see `VITE_GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_ID`). Optional **Telegram** bot login + notifications when `TELEGRAM_*` is set. |
| **Mudrex** | Link your **Mudrex API secret** from the dashboard (encrypted at rest). Wallet, orders, positions, and studio flows call Mudrex on your behalf. |
| **Sessions** | **Server-backed sessions** (`user_sessions` in Postgres): JWT cookie carries an opaque **`sid`**; rotate `JWT_SECRET` or set `REXALGO_SESSION_MIN_IAT` for mass sign-out. See [docs/PROD.md](docs/PROD.md). |
| **Redis** | Optional **`REDIS_URL`**: shared **webhook rate limits** across API replicas (recommended when horizontally scaled). |
| **Wallet / trading** | Spot & futures balances, transfers, positions, orders (via Mudrex) |
| **Algo marketplace** | Browse & subscribe to `algo` strategies with **margin per trade** |
| **Strategy studio** | Masters create **algo** listings, **signed webhooks** — **`/marketplace/studio`** via **Master studio → Strategy** |
| **Copy trading** | Browse `copy_trading` strategies, subscribe; studio at **`/copy-trading/studio`** |
| **Master studio** | Approved masters get **Strategy**, **Copy trading**, and **Dashboard** views (master access + admin gates). Dashboard shows aggregate subscribers, volume, signals, and Telegram delivery state without subscriber PII. |
| **Strategy signal webhook** | `POST /api/webhooks/strategy/{strategyId}` (legacy: `/api/webhooks/copy-trading/...`) with **HMAC or body `secret`** → mirror **open/close** to subscribers |
| **TradingView** | User-owned **`/tv-webhooks`**, `POST /api/webhooks/tv/{id}` adapter, media-kit square mark in UI |
| **Admin** | **`/admin`** when your email is in **`ADMIN_EMAILS`** (master access, strategies, users) |
| **Single UI** | Product screens in **`frontend/`**; **`backend/`** is API-only (+ health). |

---

## Repository layout

```
RexAlgo/
├── frontend/              # Vite + React Router + shadcn
│   ├── src/lib/api.ts     # fetch → /api (same-origin in prod)
│   └── src/assets/        # e.g. TradingView media-kit SVG
├── backend/               # Next.js — App Router API
│   ├── src/app/api/       # REST routes
│   ├── src/lib/           # auth, db, mudrex, redis, webhooks, …
│   └── drizzle/           # SQL migrations (applied on API boot)
├── scripts/               # Operator helpers (Redis, Railway DB, Telegram)
├── repo/                  # project.json, architecture.mmd (diagram source)
├── docker-compose.yml     # postgres + api + nginx web
├── docker-compose.dev.yml # local Postgres for dev
├── docs/
│   ├── DEPLOY.md          # Railway, Vercel, topology
│   └── PROD.md            # env matrix, scaling, runbooks
├── package.json           # npm workspaces
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── LICENSE                # proprietary, all rights reserved
```

Diagram source (same graphs as below, for editors): **`repo/architecture.mmd`**.

---

## Diagram index

| Diagram | Section | What it shows |
|---------|---------|----------------|
| System context | [Architecture](#architecture) | Users, bots, app, Postgres, Redis, Mudrex, Telegram |
| Dev topology | [Architecture](#architecture) | Browser → Vite → Next → Postgres |
| Vercel + Railway | [Architecture](#architecture) | Same-origin `/api` via rewrites |
| Session & auth | [Authentication & sessions](#authentication--sessions) | Google / Telegram → API → `user_sessions` + cookie |
| Copy webhook path | [Webhooks](#webhooks--external-signals) | Bot → verify → Redis → mirror → Mudrex |
| TV webhook path | [Webhooks](#webhooks--external-signals) | TradingView → adapter → order/strategy |
| Request path | [Architecture](#architecture) | SPA → proxy → Next → Postgres / Redis / Mudrex |

All diagrams use **Mermaid** (renders on GitHub).

---

## Quick start (localhost)

End state: **one browser URL** (**127.0.0.1:8080**) for the UI; the API runs on **127.0.0.1:3000** behind Vite’s proxy.

### 1. Authorized checkout & install

Only authorized users may clone or work with this repository.

```bash
git clone https://github.com/DecentralizedJM/RexAlgo.git
cd RexAlgo
npm install
```

### 2. Environment files

On the **first** `npm run dev`, **`predev`** creates **`backend/.env.local`** from **`backend/.env.example`** if missing.

**Edit `backend/.env.local` before relying on auth or encryption:**

| Variable | Required | Notes |
|----------|----------|--------|
| `JWT_SECRET` | **Yes** | Signs session cookie (`openssl rand -hex 32`). **The API refuses to boot if unset** — no public-repo fallback. Set `REXALGO_ALLOW_DEV_SECRETS=1` in non-prod to fall back to a tagged fake. |
| `ENCRYPTION_KEY` | **Yes** | AES-GCM master key for Mudrex + webhook secrets. Each row is encrypted with a **fresh random salt** (v2 envelope); legacy single-salt rows decrypt and are re-written on next save. Same fail-fast rule as `JWT_SECRET`. |
| `DATABASE_URL` | **Yes** | Postgres, e.g. `postgres://rexalgo:rexalgo@127.0.0.1:5432/rexalgo` after `docker compose -f docker-compose.dev.yml up -d` |
| `GOOGLE_CLIENT_ID` | **Yes** for Google sign-in | Must match frontend `VITE_GOOGLE_CLIENT_ID` |
| `REDIS_URL` | Optional | `redis://127.0.0.1:6379` — cross-process webhook limits; omit for single dev instance |
| `ADMIN_EMAILS` | Optional | Comma-separated emails → `/admin` + master approvals |
| `PUBLIC_API_URL` | Recommended | No trailing slash. Full webhook URLs in studios + TV webhooks (tunnel **:3000** for local bots) |
| `PUBLIC_APP_URL` | Legacy / fallback | Telegram redirect fallback; prefer `PUBLIC_API_URL` for webhook bases |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Optional | Bot login + `POST /api/telegram/webhook`; see [docs/PROD.md](docs/PROD.md) |
| `REXALGO_SESSION_MAX_AGE_DAYS` | Optional | **1–90** (default **90**) |
| `REXALGO_SESSION_MIN_IAT` | Optional | Unix time — reject older JWTs (emergency mass sign-out) |

**Frontend:** create **`frontend/.env.local`** with **`VITE_GOOGLE_CLIENT_ID`** (same OAuth client id as **`GOOGLE_CLIENT_ID`** on the API).

```bash
cp backend/.env.example backend/.env.local
```

Restart **`npm run dev`** after changing secrets.

### 3. Run both apps

```bash
npm run dev
```

| Open this | URL |
|-----------|-----|
| **Everything (UI + API)** | **[http://127.0.0.1:8080](http://127.0.0.1:8080)** |

**Prefer `127.0.0.1` over `localhost`:** separate cookie jars; `localhost` cookies apply to **all ports** on that name.

Vite **:8080** proxies **`/api`** → Next **:3000**. Session cookie is typically scoped to **`Path=/api`**. **`GET /api/health`** must return JSON with **`service":"rexalgo-api"`** before the UI starts (`wait-on`).

### 4. Verify the API (optional)

```bash
curl -s http://127.0.0.1:3000/api/health
# Expect JSON including "service":"rexalgo-api"
```

---

## Development

### Prerequisites

- **Node.js 20+**, **npm 10+**
- **PostgreSQL** — local dev:

```bash
docker compose -f docker-compose.dev.yml up -d
# DATABASE_URL=postgres://rexalgo:rexalgo@127.0.0.1:5432/rexalgo
```

### Install & run

```bash
npm run dev
```

| What | URL / notes |
|------|-------------|
| **Browser** | **http://127.0.0.1:8080** |
| **Next API** | **127.0.0.1:3000** — used via proxy; opening it directly skips SPA cookie context |

**Workspace-only:**

```bash
npm run dev -w @rexalgo/backend
npm run dev -w @rexalgo/frontend
```

### Copy trading & algo studios (signed webhooks)

1. Sign in → **Master studio** → **Copy trading** or **Strategy** → enable webhook → copy **signing secret** (once).
2. External bot: **`POST /api/webhooks/strategy/{strategyId}`** (legacy path **`/api/webhooks/copy-trading/...`** still works) with header **`X-RexAlgo-Signature: t=<unix>,v1=<hex>`** where **`v1`** = HMAC-SHA256 of **`${t}.${rawBody}`** (UTF-8) using the secret as key, or include **`secret`** in the JSON body.
3. Subscribers get mirrored **open** / **close** on Mudrex using **their** stored API secrets.
4. **Logout** clears the browser cookie; mirroring still uses **encrypted DB secrets** until keys expire.

Set **`PUBLIC_API_URL`** (or tunnel to **:3000**) so studio shows reachable URLs for external bots.

### TradingView webhooks

User-owned endpoints under **`/tv-webhooks`**; TradingView **`POST`**s to **`/api/webhooks/tv/{id}`** (see [docs/PROD.md](docs/PROD.md) for signing vs URL secrecy).

---

## Authentication & sessions

1. User opens **`/auth`** → **Google** sign-in (or Telegram when configured).
2. API verifies the credential, upserts **`users`**, creates **`user_sessions`**, returns **HttpOnly** **`rexalgo_session`** (JWS wrapping **`sid`** + metadata).
3. **Mudrex API secret** is linked separately from the **dashboard** (encrypted in Postgres). Trading and webhooks require a valid Mudrex key where applicable.

```mermaid
flowchart TB
  subgraph clients [Clients]
    BR[Browser SPA]
  end
  subgraph identity [Identity providers]
    GO[Google OAuth]
    TE[Telegram Bot]
  end
  subgraph api [Next API]
    AG["POST /api/auth/google"]
    AT["/api/auth/telegram/*"]
    AUTH[auth.ts\nsession + cookie]
  end
  subgraph data [Data plane]
    USERS[(users)]
    SESS[(user_sessions)]
  end
  BR --> GO
  BR --> TE
  GO --> AG
  TE --> AT
  AG --> AUTH
  AT --> AUTH
  AUTH --> USERS
  AUTH --> SESS
  AUTH -->|Set-Cookie| BR
```

**Operational knobs:** `REXALGO_SESSION_COOKIE_PATH`, `REXALGO_SESSION_COOKIE_DOMAIN`, `REXALGO_SESSION_MIN_IAT` — see **[docs/PROD.md](docs/PROD.md)**.

**Mudrex key rotation:** while the session is valid, the app uses the last encrypted secret; if Mudrex returns **401**, reconnect from the dashboard. Internal RexAlgo user id is tied to the Mudrex identity you linked.

---

## Webhooks & external signals

```mermaid
flowchart LR
  subgraph copy [Copy-trading signal]
    BOT[Your bot]
    WH1["/api/webhooks/strategy/{id}"]
    RL1[(Redis\noptional)]
    CM[copyMirror]
    MR1[Mudrex\nper subscriber]
  end
  BOT --> WH1
  WH1 --> RL1
  WH1 --> CM
  CM --> MR1
```

```mermaid
flowchart LR
  subgraph tv [TradingView alert]
    TVS[TradingView]
    WH2["/api/webhooks/tv/{id}"]
    RL2[(Redis\noptional)]
    EX[Adapter\norder / strategy]
    MR2[Mudrex or\ninternal routes]
  end
  TVS --> WH2
  WH2 --> RL2
  WH2 --> EX
  EX --> MR2
```

---

## Hosting: Railway and Vercel

Same-origin **`/api`** (nginx or **Vercel rewrites** → Railway) keeps **`SameSite=Lax`** cookies reliable. **Do not** point the browser at a raw Railway hostname for `/api` while the SPA lives on Vercel unless you implement cross-site cookie rules (not in this repo).

| Pattern | UI | API |
|---------|-----|-----|
| **Railway (2 services)** | Static + nginx (`frontend/Dockerfile`), `API_UPSTREAM` | Next (`backend/Dockerfile`), Postgres + optional Redis |
| **Vercel + Railway** | Static on Vercel; **`/api/*` rewrite** to Railway | Next on Railway |
| **Docker Compose** | `web` + `api` + `postgres` | See [Docker](#docker-full-stack) |

Details: **[docs/DEPLOY.md](docs/DEPLOY.md)** · Operations: **[docs/PROD.md](docs/PROD.md)**.

```mermaid
flowchart LR
  subgraph user [Browser]
    U[User]
  end
  subgraph edge [One public hostname]
    SPA[Vite static]
    RW["/api/* rewrite"]
  end
  subgraph origin [API origin]
    API[Next.js]
    PG[(Postgres)]
    RD[(Redis optional)]
  end
  U --> SPA
  SPA --> RW
  RW --> API
  API --> PG
  API -.-> RD
```

---

## Architecture

RexAlgo is a **browser client**, a **reverse proxy or edge rewrite**, **Next.js**, **Postgres**, optional **Redis**, and **Mudrex** (+ optional **Telegram**).

### System context

```mermaid
flowchart TB
  subgraph actors [Actors]
    U[Trader / user]
    B[External bots\nTV + custom]
  end
  subgraph rexalgo [RexAlgo]
    APP[Vite UI + Next API]
    PG[(PostgreSQL)]
    RD[(Redis\noptional)]
  end
  subgraph external [External]
    MR[Mudrex Futures API]
    TG[Telegram]
  end
  U -->|HTTPS| APP
  B -->|signed webhooks| APP
  APP --> PG
  APP -.->|rate limits| RD
  APP --> MR
  APP --> TG
```

### Development topology

```mermaid
flowchart LR
  subgraph dev [Developer machine]
    BR[Browser]
    V["Vite :8080"]
    N["Next :3000"]
    DB[(Postgres)]
  end
  MR[Mudrex API]
  BR --> V
  V -->|proxy /api| N
  N --> DB
  N --> MR
```

### Production (Docker Compose)

```mermaid
flowchart TB
  BR[Browser] --> NG[nginx]
  NG --> DIST[frontend dist]
  NG -->|/api| API[Next API]
  API --> PG[(Postgres\nvolume)]
  API --> MR[Mudrex API]
```

### Logical request path

```mermaid
flowchart LR
  UI[Vite SPA]
  PX[Proxy]
  NX[Next App Router]
  PG[(Postgres)]
  RD[(Redis)]
  MR[Mudrex REST]
  UI -->|/api| PX
  PX --> NX
  NX --> PG
  NX -.-> RD
  NX --> MR
```

### Backend route map (simplified)

```mermaid
flowchart TB
  MW[middleware.ts]
  subgraph auth [Auth]
    G["/api/auth/google"]
    T["/api/auth/telegram/*"]
    L["/api/auth/logout"]
  end
  subgraph product [Product + Mudrex]
    M1["/api/marketplace/*"]
    M2["/api/copy-trading/*"]
    M3["/api/mudrex/*"]
  end
  subgraph hooks [Webhooks]
    W1["/api/webhooks/strategy/*"]
    W2["/api/webhooks/tv/*"]
  end
  subgraph admin [Admin + master]
    A["/api/admin/*"]
    MA["/api/master-access/*"]
  end
  MW --> auth
  MW --> product
  MW --> hooks
  MW --> admin
```

### Google sign-in (sequence)

```mermaid
sequenceDiagram
  participant B as Browser
  participant V as Vite proxy
  participant N as Next API
  participant G as Google tokeninfo
  participant P as Postgres

  B->>V: POST /api/auth/google (id_token)
  V->>N: forward + cookies
  N->>G: verify id_token
  G-->>N: email, sub
  N->>P: upsert user + insert user_sessions
  N-->>V: Set-Cookie rexalgo_session
  V-->>B: 200 + user payload
```

### Strategy subscription (sequence)

```mermaid
sequenceDiagram
  participant B as Browser
  participant N as Next API
  participant P as Postgres
  participant M as Mudrex

  B->>N: GET /api/strategies/... (public)
  N->>P: read strategy
  N-->>B: detail

  B->>N: POST /api/subscriptions (auth)
  N->>N: validate session + Mudrex key
  N->>P: persist subscription
  N->>M: trade calls
  M-->>N: result
  N-->>B: subscription state
```

### Stack summary

| Layer | Tech | Where |
|-------|------|--------|
| UI | Vite, React Router, shadcn, TanStack Query, Tailwind | `frontend/` |
| API | Next.js App Router | `backend/src/app/` |
| Data | Postgres + Drizzle | `backend/src/lib/db.ts`, `schema.ts` |
| Cache | Redis (optional) | `backend/src/lib/redis.ts` |
| Execution | Mudrex REST | `backend/src/lib/mudrex.ts` |
| Session | JWT cookie + **`user_sessions`** | `backend/src/lib/auth.ts`, `middleware.ts` |

---

## Docker (full stack)

```bash
cp .env.example .env
# Set JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL (or use compose defaults), optional PUBLIC_API_URL

docker compose up --build -d
```

Open **http://localhost** (or **`HOST_PORT=8080`**). Nginx serves the UI and proxies **`/api`** to the API container. Postgres uses volume **`rexalgo_pg`**.

```bash
npm run docker:logs
npm run docker:down
```

---

## Scripts

### Root (`package.json`)

| Script | Description |
|--------|-------------|
| `npm run dev` | **`predev`** seeds `backend/.env.local` if missing; Next **:3000** + Vite **:8080** |
| `npm run build` | Frontend then backend production builds |
| `npm run lint` | Both workspaces |
| `npm run docker:up` / `down` / `logs` | Compose helpers |

### Repo `scripts/` (operator)

| Script | Purpose |
|--------|---------|
| `scripts/test-redis.sh` | Smoke-test **`REDIS_URL`** connectivity |
| `scripts/flush-railway-db.sh` | Guarded Railway DB URL helper (see script header) |
| `scripts/set-telegram-webhook.sh` | Point Telegram at **`/api/telegram/webhook`** (if present) |

Backend: **`npm run db:flush`** (destructive; requires explicit confirm env — see `backend/package.json`).

---

## Troubleshooting

| Issue | Try |
|--------|-----|
| **401 on `/api/*` after login** | Use the UI at **127.0.0.1:8080** (Vite), not the raw API port |
| **`npm run dev` hangs** | Free **:3000**; confirm **`/api/health`** |
| **DB errors** | **`DATABASE_URL`** reachable; migrations run on API boot |
| **Webhook 429 / uneven limits across replicas** | Set **`REDIS_URL`** so limits are global |
| **Build failures** | Node 20+; `npm install` from **repo root** |

---

## Roadmap

Structured copy: **`repo/project.json`**.

### Near term

| Item | Notes |
|------|--------|
| **CI lint** | Remove `continue-on-error` for frontend lint when clean |
| **Env templates** | Keep root + `backend/.env.example` aligned with [PROD.md](docs/PROD.md) |

### Medium term

| Item | Notes |
|------|--------|
| **Paper / dry-run** | Where Mudrex allows; clear UI |
| **Broader rate limits** | Expand Redis-backed limits beyond webhooks where needed |
| **Strategy analytics** | PnL / win rate with clear attribution |

### Longer term

| Item | Notes |
|------|--------|
| **Realtime** | SSE/WebSocket where APIs support |
| **Observability** | Latency, error budgets, structured logs |

---

## Policies & links

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — private contribution workflow
- **[SECURITY.md](SECURITY.md)** — secrets, disclosure
- **[LICENSE](LICENSE)** — proprietary, all rights reserved

---

## Changelog

The full project timeline (from the **first commit on 2026-03-21** through the
latest work on `main`) lives in **[CHANGELOG.md](CHANGELOG.md)**. That file is
the source of truth for dated milestones, security phases, migrations, and
deployment notes so the README stays readable.

| Period | What shipped (summary) |
|--------|-------------------------|
| **2026-03** | Monorepo, Mudrex, studios + signed webhooks, subscriptions, Vercel/Railway wiring, landing/auth UX, CI |
| **2026-04-18 – 04-21** | Postgres cutover, admin/TV/Telegram expansion, session + OAuth fixes |
| **2026-04-24** | Bot-first Telegram login, server-backed sessions, Redis webhook limits, security audits |
| **2026-04-25** | Production readiness, Master Dashboard, load tests, proprietary license + docs |

---

## Disclaimer

RexAlgo is **not** official Mudrex software. Crypto futures trading involves **substantial risk**. No investment advice. Use at your own risk.

---

## License

Proprietary, all rights reserved — see [LICENSE](LICENSE). No use, copying, forking, modification, deployment, or redistribution is permitted without written consent from DecentralizedJM.
