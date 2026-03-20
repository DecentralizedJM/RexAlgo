# Contributing to RexAlgo

Thanks for your interest. This repo combines:

- **`frontend/`** — Vite + React + shadcn UI (iterable via [Lovable](https://lovable.dev))
- **`backend/`** — Next.js API for Mudrex, auth, SQLite

## Local setup

```bash
npm install
npm run dev
```

- UI: [http://localhost:8080](http://localhost:8080) (Vite; proxies `/api` → Next)
- API: [http://localhost:3000](http://localhost:3000)

See the root **[README.md](README.md#development)** (development + troubleshooting).

## Pull requests

1. Fork / branch from `main`
2. Run `npm run lint` and `npm run build` where applicable
3. Describe UI vs API changes in the PR body

## Design (Lovable)

Frontend changes can be prototyped in Lovable and synced into `frontend/` (or developed directly in this repo). Keep `src/lib/api.ts` aligned with backend routes.

## Third-party code & licenses

- RexAlgo is **MIT**. Contributions must be **MIT-compatible** (avoid pasting in code that forces AGPL or other copyleft on this repo without maintainer approval).

## Roadmap & larger features

See **[README.md#roadmap](README.md#roadmap)** and **`repo/project.json`** (`roadmap`). For substantial features, open an issue with a short design first.
