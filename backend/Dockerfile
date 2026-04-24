# Next.js API (Mudrex + Postgres) — standalone build
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json ./
# Standalone backend image (no root workspace lockfile)
RUN npm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV REXALGO_SKIP_DB_BOOT=1
ENV PGSSLMODE=disable
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/rexalgo_build?sslmode=disable
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Standalone: when the image only contains this package (no repo root), Next emits
# server.js at the standalone root — not under a backend/ subfolder.
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Drizzle migrations are executed at runtime on first DB touch.
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000

# Let the orchestrator (Docker Compose / Railway / Kubernetes) detect a hung
# process or DB outage quickly. /api/health performs a `SELECT 1` + Redis
# PING, so a 200 here implies the full request path is healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
