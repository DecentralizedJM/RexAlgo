import Link from "next/link";

/**
 * This Next.js app is API-only. The RexAlgo UI lives in ../frontend (Vite SPA).
 */
export default function ApiRootPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "42rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>RexAlgo API</h1>
      <p>
        This server exposes <code>/api/*</code> only. Run the <strong>Vite</strong> app in{" "}
        <code>frontend/</code> (default <code>http://localhost:8080</code>) — it proxies API calls here.
      </p>
      <ul>
        <li>
          <Link href="/api/strategies">GET /api/strategies</Link> (public list)
        </li>
      </ul>
    </main>
  );
}
