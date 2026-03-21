#!/bin/sh
set -e

UPSTREAM="${API_UPSTREAM:-http://api:3000}"

# Host header for the Next.js upstream (Docker service name or Railway hostname)
case "$UPSTREAM" in
  http://*|https://*)
    PROXY_HOST=$(printf '%s' "$UPSTREAM" | sed -E 's|^https?://([^/:]+).*|\1|')
    ;;
  *)
    PROXY_HOST="api"
    ;;
esac

TEMPLATE="/etc/nginx/templates/default.conf.template"
OUT="/etc/nginx/conf.d/default.conf"

if [ ! -f "$TEMPLATE" ]; then
  echo "docker-entrypoint: missing $TEMPLATE" >&2
  exit 1
fi

sed -e "s|__API_UPSTREAM__|${UPSTREAM}|g" \
    -e "s|__API_PROXY_HOST__|${PROXY_HOST}|g" \
    "$TEMPLATE" > "$OUT"

echo "docker-entrypoint: API_UPSTREAM=${UPSTREAM} proxy Host=${PROXY_HOST}"

exec nginx -g "daemon off;"
