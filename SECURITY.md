# Security

RexAlgo handles **Mudrex API secrets** and **session tokens**. Treat this like production financial software.

## Secrets & configuration

- **Never commit** `backend/.env.local`, `.env`, or real Mudrex keys. Templates: `backend/.env.example`, root `.env.example` (Docker).
- **Production**: Use long random values for `JWT_SECRET` and `ENCRYPTION_KEY` (see `.env.example`). Rotate if leaked.
- **Database**: SQLite file permissions; in Docker, use a named volume and restrict host access.

## Current model (high level)

- Mudrex API secret **encrypted at rest**; **JWT** in **HttpOnly** cookie for session.
- API routes that touch Mudrex should remain **authenticated** where appropriate (see `backend/src/middleware.ts`).

## Hardening checklist (ongoing)

| Area | Status / goal |
|------|----------------|
| **HTTPS** | Required in production; terminate TLS at reverse proxy or host. |
| **Rate limiting** | Planned — login and sensitive `/api/*` routes (see [docs/ROADMAP.md](docs/ROADMAP.md)). |
| **CORS** | Restrict origins in production; dev may be permissive via Next/Vite. |
| **Headers** | Consider strict CSP, `Secure` cookies, `SameSite` for session cookie in prod. |
| **Dependency audit** | Run `npm audit`; address high/critical in lockstep with upgrades. |
| **2FA / TOTP** | Not implemented; evaluate if you add email/password beyond API-secret auth. |

## Reporting vulnerabilities

- Open a **private** security advisory on GitHub, or contact the repository owner privately.
- Do not post exploit details in public issues before a fix is available.

## Disclaimer

RexAlgo is **not** affiliated with Mudrex. Trading crypto futures carries significant risk. This document is not legal or compliance advice.
