import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/** Injects git SHA (Vercel/Railway) or ISO time into `index.html` for “did my deploy land?” checks. */
function rexalgoBuildStamp(): Plugin {
  const stamp =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ||
    new Date().toISOString();
  return {
    name: "rexalgo-build-stamp",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replaceAll("__REXALGO_BUILD__", stamp);
      },
    },
  };
}

// Dev: use http://127.0.0.1:8080 in the browser — Vite proxies /api → Next (127.0.0.1:3000).
// (localhost shares cookies across all localhost:* tabs; 127.0.0.1 is a separate cookie jar.)
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
  plugins: [rexalgoBuildStamp(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
