# Premium Vite UI (Lovable) + nginx → proxies /api to backend service
FROM node:20-bookworm-slim AS builder
WORKDIR /web
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
