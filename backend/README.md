# RexAlgo — Backend (API only)

**Next.js 16** App Router — **REST API + minimal root page**. All user-facing UI is in **`../frontend`** (Vite SPA).

- Mudrex REST client (`src/lib/mudrex.ts`)
- Auth + encrypted API secret (`src/lib/auth.ts`)
- PostgreSQL + Drizzle (`src/lib/db.ts`, `src/lib/schema.ts`)
- Optional Redis-backed shared rate limits (`src/lib/redis.ts`)

**Dev**: from repo root, `npm run dev -w @rexalgo/backend` or `npm run dev` for full stack.

**Env**: `cp .env.example .env.local` and set `JWT_SECRET`,
`ENCRYPTION_KEY`, and `DATABASE_URL`.

See [**root README**](../README.md) (architecture + roadmap), [**repo/project.json**](../repo/project.json), and [SECURITY.md](../SECURITY.md).
