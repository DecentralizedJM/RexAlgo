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
CMD ["node", "server.js"]
