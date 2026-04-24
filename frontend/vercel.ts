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
// SPA: only after static paths miss (Vercel checks dist/ before applying this).
rewrites.push({ source: "/:path*", destination: "/index.html" });

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
