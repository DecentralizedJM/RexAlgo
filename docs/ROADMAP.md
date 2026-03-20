# Roadmap

Priorities are **Mudrex-first** (crypto futures via the official API).

## Near term

| Item | Notes |
|------|--------|
| **Frontend lint clean pass** | Make `npm run lint -w @rexalgo/frontend` pass; then remove `continue-on-error` in CI for lint. |
| **CI hardening** | Optional: `npm audit` reporting (non-blocking or scheduled). |
| **Env docs** | Keep `.env.example` / `backend/.env.example` in sync with every new secret or flag. |

## Medium term

| Item | Notes |
|------|--------|
| **Webhook ingress** | Signed HTTP endpoint for external signals (e.g. TradingView) → validate → map to Mudrex actions. |
| **Paper / dry-run mode** | Simulate or flag orders without live execution where API allows; clear UI state. |
| **Rate limiting** | Login and sensitive API routes (per IP / per user). |

## Longer term

| Item | Notes |
|------|--------|
| **Realtime updates** | WebSocket or SSE for dashboard if Mudrex exposes suitable streams. |
| **Telegram / MCP** | Alerts and optional agent-driven commands (read-only first). |
| **Observability** | Request latency, Mudrex error rates, structured logs export. |

## Out of scope (by default)

| Item | Reason |
|------|--------|
| **Multi-broker / non-Mudrex execution** | RexAlgo is intentionally a **Mudrex adapter**; other venues would be separate products or forks. |
| **Copying third-party AGPL code into this tree** | Would conflict with RexAlgo’s **MIT** license unless you relicense or isolate that code legally. |

---

Contributions welcome — open an issue with a short design note before large features.
