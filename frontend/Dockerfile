# Premium Vite UI (Lovable) + nginx → proxies /api to Next (same-origin cookies).
# Set API_UPSTREAM when the API is not Docker service "api:3000" (e.g. Railway).
FROM node:20-bookworm-slim AS builder
WORKDIR /web
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /web/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
