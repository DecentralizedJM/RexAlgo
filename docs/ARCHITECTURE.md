# Architecture

RexAlgo is a **browser client**, an optional **reverse proxy**, a **Next.js backend**, a **local SQLite database**, and the **Mudrex REST API**. Diagrams use [Mermaid](https://mermaid.js.org/) (renders on GitHub and many Markdown viewers).

---

## 1. System context

Who talks to what at the highest level.

```mermaid
flowchart TB
  subgraph actors [Actors]
    U[Trader / user]
  end

  subgraph rexalgo [RexAlgo — your deployment]
    APP[RexAlgo app\nVite UI + Next API]
    DB[(SQLite)]
  end

  subgraph external [External]
    MR[Mudrex Futures API]
  end

  U -->|HTTPS| APP
  APP --> DB
  APP -->|REST + API secret| MR
```

---

## 2. Runtime topology (dev vs production)

### Development

Vite and Next run as **two processes**. The UI origin is **:8080**; Vite proxies `/api` to Next on **:3000** so session cookies stay same-origin for the browser.

```mermaid
flowchart LR
  subgraph dev [Developer machine]
    BR[Browser]
    V[Vite :8080]
    N[Next.js :3000]
    DB[(SQLite file)]
  end
  MR[Mudrex API]

  BR -->|page assets| V
  BR -->|/api/* proxied| V
  V -->|forward /api| N
  N --> DB
  N --> MR
```

### Production (Docker Compose)

Nginx serves the **static** frontend and **reverse-proxies** `/api` to the API container. SQLite lives in a **named volume**.

```mermaid
flowchart TB
  BR[Browser] -->|HTTP/S| NG[nginx]
  NG -->|static SPA| DIST[frontend dist]
  NG -->|proxy /api/*| API[Next.js API]
  API --> VOL[(Docker volume\nSQLite)]
  API --> MR[Mudrex API]
```

---

## 3. Request path (logical)

Same logical path in dev (via Vite) and prod (via nginx).

```mermaid
flowchart LR
  UI[Vite SPA]
  PX[Proxy\nVite or nginx]
  NX[Next.js App Router]
  DB[(SQLite)]
  MR[Mudrex REST]

  UI -->|"/api/*"| PX
  PX --> NX
  NX --> DB
  NX --> MR
```

---

## 4. Backend structure (modules)

```mermaid
flowchart TB
  subgraph routes [app/api]
    A1["/api/auth/*"]
    A2["/api/strategies/*"]
    A3["/api/subscriptions"]
    A4["/api/mudrex/*"]
  end

  subgraph lib [lib]
    AUTH[auth.ts\nJWT + encrypt secret]
    MR[mudrex.ts\nHTTP client]
    DBL[db.ts + schema.ts\nDrizzle]
  end

  MW[middleware.ts]

  MW --> routes
  routes --> AUTH
  routes --> MR
  routes --> DBL
  AUTH --> DBL
  MR -->|outbound HTTPS| EXT[Mudrex]
```

---

## 5. Authentication sequence

```mermaid
sequenceDiagram
  participant B as Browser
  participant V as Vite :8080
  participant N as Next API
  participant M as Mudrex API

  B->>V: POST /api/auth/login (secret)
  V->>N: forward + cookie jar
  N->>M: validate credentials
  M-->>N: OK / error
  N-->>V: Set-Cookie HttpOnly JWT
  V-->>B: response + cookie
  Note over B,N: Later requests include cookie; secret stored encrypted in SQLite
```

---

## 6. Strategy subscription flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant N as Next API
  participant D as SQLite
  participant M as Mudrex

  B->>N: GET /api/strategies/:id (public)
  N->>D: load strategy
  N-->>B: strategy detail

  B->>N: POST /api/subscriptions + margin (auth)
  N->>N: verify JWT + user
  N->>D: persist subscription
  N->>M: trading calls with user secret
  M-->>N: result
  N-->>B: subscription state
```

---

## Frontend (`frontend/`)

- **Vite** + **React Router** + **shadcn/ui** + **Tailwind**
- **TanStack Query** for server state
- **`src/lib/api.ts`** — `fetch("/api/...")` with `credentials: "include"`
- UI lineage: **Lovable** / [rex-trader-playground](https://github.com/DecentralizedJM/rex-trader-playground)

## Backend (`backend/`)

- **Next.js 16** App Router
- **SQLite** + **Drizzle ORM** — users, strategies, subscriptions, trade logs
- **Mudrex** — wallet, assets, orders, positions, leverage (`src/lib/mudrex.ts`)
- **Auth** — JWT in HttpOnly cookie; API secret encrypted at rest (`src/lib/auth.ts`)

## Planned extensions

See [ROADMAP.md](./ROADMAP.md): webhooks, paper/dry-run, rate limiting, realtime, observability.

## Related docs

- [Mudrex API overview](https://docs.trade.mudrex.com/docs/overview)
- Unofficial Python SDK: [mudrex-api-trading-python-sdk](https://github.com/DecentralizedJM/mudrex-api-trading-python-sdk)
