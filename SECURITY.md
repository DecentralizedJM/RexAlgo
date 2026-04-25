# Security

RexAlgo handles **Mudrex API secrets** and **session tokens**. Treat this like production financial software.

## Secrets & configuration

- **Never commit** `backend/.env.local`, `.env`, or real Mudrex keys. Templates: `backend/.env.example`, root `.env.example` (Docker).
- **Production**: Use long random values for `JWT_SECRET` and `ENCRYPTION_KEY` (see `.env.example`). Rotate if leaked.
- **Database**: PostgreSQL stores sessions, encrypted secrets, strategies, trade ledger rows, notifications, and audit data. Restrict network access and use managed backups/snapshots in production.

## Current model (high level)

- Mudrex API secret is securely encrypted in storage, and a server-backed session cookie is held in an **HttpOnly** cookie for session management.
- API routes that touch Mudrex should remain **authenticated** where appropriate (see `backend/src/middleware.ts`).
- **Copy-trading webhooks** (`POST /api/webhooks/copy-trading/*`) are **unauthenticated** but **HMAC-signed** (see `backend/src/lib/copyWebhookHmac.ts`). Signing secrets are encrypted in PostgreSQL like user secrets. Rotate a leaked secret from **Copy trading studio** (open it from **Master studio** in the top nav). Redis-backed per-strategy rate limits are used when configured for multi-instance production.

## Copy-trading mirroring risk

- A verified webhook can cause **real orders** on **followers’** Mudrex accounts. Masters must protect bot credentials and webhook URLs.
- **Partial failures** are expected (margin, exchange rules); check studio **signal history** and server logs. This is **not** a guarantee of identical fills across accounts.

## Hardening checklist (ongoing)

| Area | Status / goal |
|------|----------------|
| **HTTPS** | Required in production; terminate TLS at reverse proxy or host. |
| **Rate limiting** | In-process limit on copy webhooks; extend with gateway limits for login and other `/api/*` routes (see [README.md#roadmap](README.md#roadmap)). |
| **CORS** | Restrict origins in production; dev may be permissive via Next/Vite. |
| **Headers** | Consider strict CSP, `Secure` cookies, `SameSite` for session cookie in prod. |
| **Dependency audit** | Run `npm audit`; address high/critical in lockstep with upgrades. |
| **2FA / TOTP** | Not implemented; evaluate if you add email/password beyond API-secret auth. |

## Reporting vulnerabilities

- Open a **private** security advisory on GitHub, or contact the repository owner privately.
- Do not post exploit details in public issues before a fix is available.

## Disclaimer

RexAlgo is **not** affiliated with Mudrex. Trading crypto futures carries significant risk. This document is not legal or compliance advice.
