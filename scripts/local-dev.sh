#!/usr/bin/env bash
# Start Postgres (Docker), apply migrations, then run API + Vite together.
# Usage (from repo root):  bash scripts/local-dev.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH."
  echo "Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then run this script again."
  exit 1
fi

echo "Starting Postgres (docker-compose.dev.yml)..."
docker compose -f docker-compose.dev.yml up -d

echo "Waiting for Postgres to accept connections..."
for i in $(seq 1 45); do
  if docker compose -f docker-compose.dev.yml exec -T postgres \
    pg_isready -U rexalgo -d rexalgo >/dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  if [ "$i" -eq 45 ]; then
    echo "Timed out waiting for Postgres. Check: docker compose -f docker-compose.dev.yml logs postgres"
    exit 1
  fi
  sleep 1
done

if [ ! -f backend/.env.local ]; then
  echo "Creating backend/.env.local from backend/.env.example"
  cp backend/.env.example backend/.env.local
fi

echo "Applying database migrations..."
(cd backend && npm run db:migrate)

echo "Starting API (3000) + frontend (8080)..."
npm run dev
