# RexAlgo

**RexAlgo** is a full-stack platform for **algorithmic strategies** and **copy trading**, built on the [**Mudrex Futures API**](https://docs.trade.mudrex.com/docs/overview). It pairs a premium **Vite + React** UI (shadcn, Tailwind) with a **Next.js** API, SQLite, and optional **Docker** deployment.

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#repository-layout">Layout</a> ·
  <a href="#docker-full-stack">Docker</a> ·
  <a href="#credits">Credits</a>
</p>

---

## Features

| Area | What you get |
|------|----------------|
| **Auth** | Connect with your **Mudrex API secret**; encrypted storage + JWT session |
| **Wallet / trading** | Spot & futures balances, transfers, positions, orders (via Mudrex) |
| **Algo marketplace** | Browse & subscribe to `algo` strategies with **margin per trade** |
| **Copy trading** | Browse `copy_trading` strategies, subscribe, same margin model |
| **Backend UI** | Optional Next.js dashboard pages (`/dashboard/*`) for power users |

---

## Repository layout

```
RexAlgo/
├── frontend/          # Premium SPA — Vite, React Router, shadcn (Lovable design lineage)
│   ├── src/
│   │   ├── lib/api.ts # Calls /api (proxied to backend in dev & Docker)
│   │   └── pages/
│   ├── Dockerfile     # Production: static build + nginx
│   └── nginx.conf     # Reverse-proxy /api → backend
├── backend/           # Next.js 16 API — Mudrex client, Drizzle, auth
│   ├── src/app/       # App Router (API routes + optional dashboard pages)
│   └── Dockerfile     # Standalone Node server
├── docs/              # Architecture & dev guides
├── docker-compose.yml # Run web + api together
├── package.json       # npm workspaces (root scripts)
└── LICENSE            # MIT
```

---

## Quick start

### 1. Clone & install

```bash
git clone https://github.com/DecentralizedJM/RexAlgo.git
cd RexAlgo
npm install
```

### 2. Backend env

```bash
cp backend/.env.example backend/.env.local
# Set JWT_SECRET and ENCRYPTION_KEY
```

### 3. Run both apps

```bash
npm run dev
```

| Service | URL |
|--------|-----|
| **UI** | [http://localhost:8080](http://localhost:8080) |
| **API** | [http://localhost:3000](http://localhost:3000) |

The dev server proxies `frontend` → `/api` → `backend`, so cookies stay same-origin on `:8080`.

Sign in at **`/auth`** with your **Mudrex API secret**.

More detail: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Docker (full stack)

```bash
cp .env.example .env
# Edit JWT_SECRET, ENCRYPTION_KEY. Optional: HOST_PORT=8080

docker compose up --build -d
```

Open **http://localhost** (or **http://localhost:8080** if `HOST_PORT=8080`).  
Nginx serves the UI and proxies **`/api`** to the API container. SQLite persists in volume **`rexalgo_data`**.

```bash
npm run docker:logs   # or: docker compose logs -f
npm run docker:down
```

---

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev` | Frontend (8080) + backend (3000) |
| `npm run build` | Build both workspaces |
| `npm run lint` | Lint frontend & backend (if configured) |
| `npm run docker:up` | `docker compose up --build -d` |

Workspace-only:

```bash
npm run dev -w @rexalgo/frontend
npm run dev -w @rexalgo/backend
```

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagrams & data flow  
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local setup  
- [CONTRIBUTING.md](CONTRIBUTING.md)  
- [SECURITY.md](SECURITY.md)  

---

## Credits

- **UI / design workflow**: Evolved from [**Lovable**](https://lovable.dev) and the [**rex-trader-playground**](https://github.com/DecentralizedJM/rex-trader-playground) repo — merged here as **`frontend/`** for a single canonical app.
- **Execution**: [**Mudrex**](https://mudrex.com) Futures API — see [official API docs](https://docs.trade.mudrex.com/docs/overview).
- **SDK reference** (unofficial): [mudrex-api-trading-python-sdk](https://github.com/DecentralizedJM/mudrex-api-trading-python-sdk).

---

## Disclaimer

RexAlgo is **not** official Mudrex software. Crypto futures trading involves **substantial risk**. No investment advice. Use at your own risk.

---

## License

MIT — see [LICENSE](LICENSE).
