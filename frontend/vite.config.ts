import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Monorepo `npm run dev`: gateway serves :8080; Vite is loopback-only (no /api proxy).
// Standalone `npm run dev -w @rexalgo/frontend`: Vite :8080 + proxy /api → Next.
const INTERNAL = process.env.VITE_INTERNAL_DEV === "1";
const API_TARGET = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000";

const GATEWAY = Number(process.env.REXALGO_GATEWAY_PORT || 8080);

export default defineConfig(({ mode }) => ({
  server: {
    host: INTERNAL ? "127.0.0.1" : "::",
    port: INTERNAL ? 5174 : 8080,
    strictPort: true,
    // Match browser URL (localhost) so Vite doesn’t fight the Host header from the gateway
    ...(INTERNAL ? { origin: `http://localhost:${GATEWAY}` } : {}),
    hmr: {
      overlay: false,
      ...(INTERNAL
        ? {
            protocol: "ws",
            host: "localhost",
            port: GATEWAY,
            clientPort: GATEWAY,
          }
        : {}),
    },
    proxy: INTERNAL
      ? {}
      : {
          "/api": {
            target: API_TARGET,
            changeOrigin: true,
            secure: false,
          },
        },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
