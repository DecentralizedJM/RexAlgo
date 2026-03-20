# Development

## Prerequisites

- Node.js **20+**
- npm 10+

## Install

From the repository root:

```bash
npm install
```

This installs root tooling and both workspaces (`frontend`, `backend`) via npm workspaces.

## Run both apps

```bash
npm run dev
```

| App       | URL                   | Notes                                      |
| --------- | --------------------- | ------------------------------------------ |
| Frontend  | http://localhost:8080 | Vite; `/api` proxied to Next on 3000       |
| Backend   | http://localhost:3000 | Next.js App Router                         |

### Run individually

```bash
npm run dev -w @rexalgo/frontend
npm run dev -w @rexalgo/backend
```

## Backend environment

```bash
cp backend/.env.example backend/.env.local
```

Set `JWT_SECRET` and `ENCRYPTION_KEY` (see `backend/.env.example`). Optional: `REXALGO_DB_PATH` for a custom SQLite file path.

## Auth flow

1. Open the UI → **Connect** / **Auth**
2. Enter your **Mudrex API secret** (validated against [Mudrex Futures API](https://docs.trade.mudrex.com/docs/overview))
3. Session cookie is set on the UI origin; dev proxy forwards `/api` so cookies stay same-origin

## Docker

See root [README.md](../README.md#docker-full-stack).
