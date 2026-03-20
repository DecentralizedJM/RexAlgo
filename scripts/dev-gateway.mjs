#!/usr/bin/env node
/**
 * Single URL for local dev: browser only talks to this port.
 * /api/* → Next.js (loopback) · everything else → Vite (loopback), including HMR WebSockets.
 */
import http from "node:http";
import httpProxy from "http-proxy";

const GATEWAY_PORT = Number(process.env.REXALGO_GATEWAY_PORT || process.env.PORT || 8080);
const NEXT = process.env.REXALGO_NEXT_URL || "http://127.0.0.1:3000";
const VITE = process.env.REXALGO_VITE_URL || "http://127.0.0.1:5174";

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, req, res) => {
  console.error("[gateway] proxy error:", err.message);
  if (res && typeof res.writeHead === "function" && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain" });
  }
  if (res && typeof res.end === "function") res.end("Bad gateway — is Next (3000) and Vite (5174) up?");
});

function pickTarget(url) {
  return url.startsWith("/api") ? NEXT : VITE;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  proxy.web(req, res, { target: pickTarget(url) });
});

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "/";
  proxy.ws(req, socket, head, { target: pickTarget(url) });
});

server.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(
    `[gateway] http://localhost:${GATEWAY_PORT}  (UI → ${VITE}  |  API → ${NEXT})`,
  );
});
