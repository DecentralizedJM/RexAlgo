# RexAlgo — Backend

**Next.js 16** App Router API:

- Mudrex REST client (`src/lib/mudrex.ts`)
- Auth + encrypted API secret (`src/lib/auth.ts`)
- SQLite + Drizzle (`src/lib/db.ts`, `src/lib/schema.ts`)
- Optional dashboard routes under `src/app/dashboard/*` (legacy/alternate UI)

**Dev**: from repo root, `npm run dev -w @rexalgo/backend` or `npm run dev` for full stack.

**Env**: `cp .env.example .env.local` and set `JWT_SECRET`, `ENCRYPTION_KEY`.

See [**root README**](../README.md) and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
