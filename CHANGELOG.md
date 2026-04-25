# Changelog

This file is the **canonical project history** for RexAlgo: dated milestones,
major features, security work, and deployment notes. For legal terms see
[LICENSE](LICENSE). For how to contribute see [CONTRIBUTING.md](CONTRIBUTING.md).

## History at a glance

| Period | Themes |
|--------|--------|
| **2026-03** | Monorepo bootstrap, Mudrex integration, Master Studio (strategy + copy), signed webhooks and mirroring, subscriptions, Vercel/Railway wiring, landing and auth UX, CI, early security headers |
| **2026-04-01 – 2026-04-05** | Routine maintenance commits on the recorded timeline |
| **2026-04-06 – 2026-04-17** | No commits appear in `git log` for this window on `main` |
| **2026-04-18** | Postgres cutover, Master Studio access control, admin flows, Telegram groundwork, production documentation |
| **2026-04-19** | Public listings UX, deploy hardening, dashboard diagnostics, TradingView mark integration (later refined) |
| **2026-04-20** | Admin v2, TradingView webhooks, quotas, trade ledger, Mudrex tiered rate limiting, Telegram operator scripts |
| **2026-04-21** | Telegram OAuth and HMAC fixes, session cookie scoping for Vercel→Railway, logout correctness |
| **2026-04-22** | Toolchain housekeeping: Node engines field, typecheck script, branch naming docs, Redis fallback docs |
| **2026-04-23** | Docs polish: .node-version, SECURITY checklist refresh, webhook skew knob, SameSite=Strict fix |
| **2026-04-24** | Bot-first Telegram login, server-backed sessions, Redis-backed webhook limits, security audit phases, docs refresh |
| **2026-04-25** | Production readiness bundle, load-test tooling, Master Dashboard, proprietary license and documentation refresh |

---

## 2026-03-21 — Monorepo bootstrap

- Introduced the **Vite + React** frontend with **Next.js** API workspace layout.
- Added **Mudrex** REST integration, wallet/positions/orders surfaces, and early
  **dashboard** wiring.
- Added **copy-trading and algo studios**, **signed copy webhooks**, subscriber
  mirroring path, and documentation.
- Added **subscriptions** management, funding warnings, and deploy notes.
- Wired **Vercel** `frontend/vercel.json` to proxy **`/api`** toward Railway.
- Added **Mudrex** retry/backoff and wallet staggering for rate-limit resilience.
- Improved **auth** ergonomics: session length configuration, `/me` session
  metadata, Mudrex key rotation banner, and clearer sign-in copy.
- Established **CI** hygiene (`npm ci`, lockfile checks) and fixed ESLint across
  workspaces.
- Fixed **Mermaid** diagram compatibility for GitHub rendering.
- Standardized local dev on **Vite :8080** with built-in **`/api` proxy** to
  Next **:3000** (replacing earlier gateway experiments).

## 2026-03-22 — 2026-03-31 — Product iteration

- **Landing**: Bybit linear ticker strip, WebSocket fallbacks, footer and stats
  polish, Framer Motion experiments (later partially reverted for stability).
- **Market data**: neutral ticker APIs, calmer polling, pill layout tuning.
- **Auth**: protected-route gating, Google SSO + stable identity, premium Google
  button styling, cookie clearing improvements.
- **Brand**: RexAlgo wordmark rollout, favicon PNG, gradient mark assets.
- **Marketplace**: strategy-bound **backtest** (OHLC + studio UI).
- **Deploy**: Railway on **`main`**, root **`railway.toml`** + **`Dockerfile.api`**
  to avoid Railpack ambiguity; Docker standalone layout fixes.
- **Security**: backend hardening iterations (headers/rate limit/key caching),
  later refined with reverts where needed; streak log housekeeping entries.

---

## 2026-04-01 — 2026-04-05

- Maintenance cadence commits recorded on these dates (see `git log` for the
  exact sequence).

## 2026-04-06 — 2026-04-17

- No commits are present in `git log` on `main` across this calendar range.

---

## 2026-04-18 — Postgres and production-shaped platform

- Migrated the product to **PostgreSQL** as the primary datastore; removed
  SQLite assumptions from Docker deploy path.
- Tightened **Master Studio** access gating and expanded **admin** capabilities.
- Added **TradingView webhook** foundations and **Telegram** operator-facing
  documentation.
- Improved API **boot** behavior around migrations and production builds.

## 2026-04-19 — UX, deploy polish, TradingView mark

- Refined public listings copy and admin-only diagnostics on the dashboard.
- Improved Vercel/Railway documentation, cache headers, and SPA build stamp.
- Iterated on **TradingView** geometric mark rendering (SVG → `img` square box)
  to avoid distortion across themes.

## 2026-04-20 — Admin v2, TV webhooks, ledger, Mudrex limits

- Shipped **admin v2**, **TradingView webhooks**, strategy **quotas**, and a
  forward-looking **`trade_logs`** ledger for volume analytics.
- Added **tiered Mudrex rate limiting** extensions and notification kinds for
  strategy review outcomes.
- Added **Telegram verification** operator script and deploy checklist updates.

## 2026-04-21 — Telegram OAuth and session cookies

- Stabilized Telegram login widget behavior across re-renders and redirect flows.
- Fixed OAuth/HMAC edge cases for Vercel↔Railway hosting split.
- Scoped **`rexalgo_session`** cookie `Domain` for proxied deployments and
  improved logout behavior across cookie variants.

## 2026-04-22 — Maintenance and toolchain housekeeping

- Added `"engines": {"node": ">=20"}` to `backend/package.json` to make the
  Node version requirement explicit for CI and local tooling.
- Added `typecheck` script (`tsc --noEmit`) to `backend/package.json` for
  faster type-only CI checks without a full build.
- Expanded **`CONTRIBUTING.md`** with a branch naming convention section
  (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `security/`).
- Documented `REXALGO_ALLOW_DEV_SECRETS` and the **Redis memory-fallback**
  behaviour in `docs/PROD.md`: without `REDIS_URL`, rate limits fall back to
  per-replica in-memory state (fail-open) — acceptable for single-instance dev,
  not for multi-replica production.

## 2026-04-23 — Docs polish and deploy notes

- Added `.node-version` file (`20`) at repo root for toolchain pinning via
  `nvm`, `fnm`, and similar version managers.
- Updated the **`SECURITY.md`** hardening checklist to reflect controls that
  have shipped: per-IP auth rate limiting, security headers in middleware,
  `SameSite=Strict` session cookies, and the admin audit log.
- Documented `REXALGO_WEBHOOK_MAX_SKEW_SEC` in `docs/PROD.md` (default `60`,
  clamped 30–900 — tightens the copy-webhook replay window).
- Fixed stale `SameSite=Lax` references in `docs/DEPLOY.md` to reflect the
  current `SameSite=Strict` cookie policy.

---

## 2026-04-24 — Bot-first Telegram, sessions, Redis limits, audits

- Replaced fragile Telegram widget flows with **bot-first deep link** login and
  webhook completion.
- Landed **server-backed sessions** (`user_sessions`) and **Redis-backed**
  distributed webhook rate limiting for multi-instance safety.
- Added guarded **`db:flush`** tooling and Railway DB helper scripts with strict
  URL validation (reject internal Railway hostnames for local tooling).
- Refreshed README for Postgres/Redis topology and completed **security audit**
  phases 1–2.

## 2026-04-25 — Production readiness, Master Dashboard, docs

### Master Studio dashboard

- Added an approved-master-only dashboard at `/master-studio/dashboard`.
- Added `GET /api/master/dashboard` for owner-scoped aggregates only.
- Added strategy-level subscriber counts, generated volume, signal counts, last
  signal time, webhook state, and recent mirror outcomes.
- Added recent signal activity summaries without subscriber PII. The dashboard
  does not expose subscriber emails, names, phone numbers, Telegram IDs, or raw
  subscriber user IDs.
- Added Telegram delivery status and a settings CTA from the dashboard.
- Added Telegram notifications to strategy owners when signed copy-trading
  signals are accepted and processed.
- Added dashboard aggregation indexes for subscriptions, trade logs, copy signal
  events, and mirror attempts.

### Production readiness and load resilience

- Added strict production configuration validation so production boots fail fast
  when required secrets or OAuth settings are missing.
- Hardened Google auth audience validation.
- Added server-backed session safety improvements and production-oriented secret
  handling.
- Added request correlation, structured logging, client telemetry ingestion, and
  alertable health/readiness endpoints.
- Added a detailed `/api/ready` endpoint for DB, Redis, notification outbox, and
  dependency status.
- Added a throttled `/api/health` database probe to avoid connection pool
  stampedes under load balancers and k6 tests.
- Added cached public strategy listings with explicit revalidation on strategy
  changes.
- Increased default PostgreSQL pool capacity for a busy single API replica while
  keeping `PGPOOL_MAX` configurable for multi-replica deployments.
- Added k6 and smoke load-test scripts for production-readiness validation.

### Database and migrations

- Added deterministic Drizzle migrations for notification backoff/admin audit,
  production readiness, public strategy listing performance, and master
  dashboard aggregates.
- Added public strategy listing index for approved, active strategies ordered by
  newest first.
- Added replica-safe notification claiming with processing leases and retry
  scheduling.
- Added retention cleanup tooling for production data hygiene.

### Copy trading, webhooks, and idempotency

- Hardened copy-trading webhook idempotency against duplicate or concurrent
  deliveries.
- Added durable copy-signal and mirror-attempt tracking for aggregate strategy
  outcomes.
- Added Redis-backed Mudrex and webhook rate-limit paths for multi-instance
  production.
- Added owner-facing Telegram summaries for accepted copy-trading signal
  transactions.

### Admin, audit, and compliance

- Added admin audit logging for sensitive admin mutations.
- Added admin audit API and dashboard visibility.
- Hardened strategy moderation and listing state transitions.
- Hardened master access approval flows and user-facing notifications.
- Added frontend handling for auth degradation and key/session error states.

### Frontend and navigation

- Added Master Studio Dashboard route and navigation entry.
- Ordered Master Studio dropdown as Strategy, Copy trading, Dashboard.
- Added official Telegram plane icon for Telegram settings CTA.
- Improved error boundary and refresh behavior.
- Added frontend telemetry for client-side failures.

### Deployment and licensing

- Verified Railway production deployment and Vercel frontend/API rewrite health.
- Ran k6 against the Railway production API and iterated on hot-path performance.
- Switched the repository license to **proprietary, all rights reserved** and
  aligned CONTRIBUTING/SECURITY documentation with PostgreSQL/Redis reality.

---

## Verification

To inspect the raw commit sequence at any time:

```bash
git log --oneline --reverse
```

For month-level counts on `main`:

```bash
git log --format=%cs --reverse | awk '{print substr($1,1,7)}' | uniq -c
```
