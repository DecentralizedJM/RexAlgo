/**
 * Vercel programmatic config (build-time).
 *
 * We used to use `routes` in `vercel.json` so `$API_UPSTREAM` could proxy `/api/*`.
 * That broke production: the catch-all `/(.*)` → `/index.html` ran **before**
 * static files, so `/assets/*.js` returned HTML → blank white page.
 *
 * `rewrites` give **filesystem precedence** (Vercel serves `dist/assets/*` first),
 * then fall through to the SPA rewrite. `API_UPSTREAM` is read here from
 * `process.env` (set in the Vercel project for Preview + Production).
 *
 * @see https://vercel.com/docs/project-configuration/vercel-ts
 */
const upstream = (process.env.API_UPSTREAM ?? "").trim().replace(/\/$/, "");

if (process.env.VERCEL === "1" && !upstream) {
  console.warn(
    "[vercel] API_UPSTREAM is unset — /api/* will not be proxied. " +
      "Add API_UPSTREAM (Railway API origin, no trailing slash) in Vercel → Settings → Environment Variables."
  );
}

const rewrites: { source: string; destination: string }[] = [];
if (upstream) {
  rewrites.push({
    source: "/api/:path*",
    destination: `${upstream}/api/:path*`,
  });
}
/**
 * SPA shell — **must not** match Vite bundles under `/assets/*` or root files from
 * `public/` (`*.png`, `favicon.ico`, etc.). On some deployments the broad
 * `/:path* → /index.html` rule is applied even when a static file exists, which
 * serves HTML for `.css`/`.js` → the page renders unstyled (HTML only, no layout).
 *
 * @see https://stackoverflow.com/questions/64920230
 */
rewrites.push({
  source:
    "/((?!assets/|rexalgo-mark\\.png|rexalgo-logo\\.png|mudrex-logo\\.png|favicon\\.ico|robots\\.txt|placeholder\\.svg).*)",
  destination: "/index.html",
});

export const config = {
  installCommand: "npm install",
  buildCommand: "npm run build",
  outputDirectory: "dist",
  headers: [
    {
      source: "/assets/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
    {
      source: "/index.html",
      headers: [
        {
          key: "Cache-Control",
          value: "no-store, no-cache, must-revalidate, max-age=0",
        },
      ],
    },
  ],
  rewrites,
};
