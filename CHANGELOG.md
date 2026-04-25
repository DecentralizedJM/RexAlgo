# Changelog

This changelog tracks the major RexAlgo product, platform, security, and
deployment changes. Dates use the repository working timezone unless noted.

## 2026-04-25

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

### Deployment

- Verified Railway production deployment and Vercel frontend/API rewrite health.
- Installed and ran k6 against the Railway production API.
- Triggered git-based production redeploys from `main`.

## 2026-04-24

### Frontend deployment stability

- Fixed Vercel SPA rewrites so `/assets/*` and public image assets are not
  captured by the app fallback route.
- Switched Vercel routing to rewrite-based SPA delivery for stable refreshes and
  deep links.
- Added the official RexAlgo mark asset and corrected broken logo references.

### Auth and database hardening

- Added user secret fingerprint backfill support.
- Added duplicate-key guards for fingerprint migration paths.
- Ensured Drizzle migrations run on API boot to self-heal schema drift.
- Allowed production builds to complete without runtime Railway secrets while
  preserving runtime validation.

## 2026-04-21

### Master access and marketplace moderation

- Added Master Studio approval workflow for strategy creators.
- Added admin strategy approval/rejection controls.
- Added public listing gates so only approved and active strategies are visible.
- Added resubmission flows for rejected strategy and copy-trading listings.

## 2026-04-18

### Initial platform foundation

- Added Vite React frontend and Next.js API backend.
- Added PostgreSQL schema for users, strategies, subscriptions, copy webhooks,
  copy signal events, trade logs, Telegram auth, notifications, and admin audit
  structures.
- Added Mudrex wallet, positions, orders, and strategy subscription flows.
- Added copy-trading webhook infrastructure with HMAC signatures.
- Added Docker and local development scripts.

## Licensing Note

RexAlgo is proprietary software. See [LICENSE](LICENSE). No use, copying,
forking, modification, deployment, or redistribution is permitted without
written consent from DecentralizedJM.
