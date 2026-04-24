<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mudrex outbound traffic

All outbound calls to `https://trade.mudrex.com/fapi/v1/...` **must** go through
`mudrexFetch` in `src/lib/mudrex.ts`. Do not call `fetch("https://trade.mudrex.com/…")`
directly anywhere else — the client applies the per-API-key, per-tier rate
limiter in `src/lib/mudrexRateLimit.ts` (Enhanced vs Standard per Mudrex
v1.0.5) and retry/backoff logic you would otherwise duplicate.

When you add a new Mudrex endpoint:

1. Add a thin wrapper in `src/lib/mudrex.ts` that calls `mudrexFetch(...)`.
2. If the new endpoint belongs to the Enhanced tier, add its method + path
   regex to `ENHANCED_RULES` in `src/lib/mudrexRateLimit.ts`. Anything not
   listed there is classified as Standard automatically.
3. If the call is invoked from a background path (copy-mirror loop, TradingView
   webhook, pagination, cron), plumb `context: "background"` through so the
   limiter uses the longer wait budget (`MUDREX_RL_MAX_WAIT_BACKGROUND_MS`)
   and users never block on upstream bursts.
