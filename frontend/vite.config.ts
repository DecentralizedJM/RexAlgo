import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Dev: only open http://localhost:8080 — Vite proxies /api → Next (127.0.0.1:3000).
// HMR + HTTP share :8080, so no separate gateway (avoids WebSocket / 426 issues).
const API_TARGET = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000";

export default defineConfig(({ mode }) => ({
  server: {
    host: true,
    port: 8080,
    strictPort: true,
    // Show runtime errors in-browser during dev (helps when the screen would otherwise stay blank)
    hmr: { overlay: true },
    proxy: {
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
