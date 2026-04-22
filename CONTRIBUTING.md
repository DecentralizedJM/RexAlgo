# Contributing to RexAlgo

RexAlgo is proprietary software. Contributions are accepted only from people or
organizations explicitly authorized by DecentralizedJM.

Do not fork, copy, clone, modify, publish, deploy, or redistribute this
repository unless DecentralizedJM has granted you written permission.

This repo combines:

- **`frontend/`** — Vite + React + shadcn UI (iterable via [Lovable](https://lovable.dev))
- **`backend/`** — Next.js API for Mudrex, auth, PostgreSQL, Redis-backed production hardening

## Local setup

```bash
npm install
npm run dev
```

- UI: [http://localhost:8080](http://localhost:8080) (Vite; proxies `/api` → Next)
- API: [http://localhost:3000](http://localhost:3000)

See the root **[README.md](README.md#development)** (development + troubleshooting).

## Branch naming

Use the format `<type>/<short-description>` where `type` is one of:
`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `security`.

Examples: `feat/telegram-login`, `fix/session-cookie-domain`, `chore/deps-bump`.

## Pull requests

1. Work from an authorized private branch.
2. Run `npm run lint` and `npm run build` where applicable.
3. Describe UI vs API changes in the PR body.
4. Do not include secrets, credentials, customer data, or copied third-party code.

## Design (Lovable)

Frontend changes can be prototyped in Lovable and synced into `frontend/` (or developed directly in this repo). Keep `src/lib/api.ts` aligned with backend routes.

## Third-party code & licenses

- RexAlgo is **proprietary, all rights reserved**.
- Contributions must not introduce license terms that force public disclosure,
  redistribution rights, or copyleft obligations on this repository without
  written approval from DecentralizedJM.
- By contributing, you confirm you have the right to submit the work and assign
  or license it to DecentralizedJM for use in RexAlgo.

## Roadmap & larger features

See **[README.md#roadmap](README.md#roadmap)**, **[CHANGELOG.md](CHANGELOG.md)**,
and **`repo/project.json`** (`roadmap`). For substantial features, open an issue
with a short design first.
