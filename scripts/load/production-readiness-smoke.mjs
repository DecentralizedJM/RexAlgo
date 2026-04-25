#!/usr/bin/env node
/**
 * Dependency-free load smoke runner for environments where k6 is not installed.
 * Use k6 for authoritative results; this script is a quick CI/staging fallback.
 */
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const vus = Number.parseInt(process.env.VUS || "500", 10);
const iterations = Number.parseInt(process.env.ITERATIONS || "1", 10);
const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
  console.log(
    JSON.stringify({
      ok: true,
      mode: "dry-run",
      baseUrl,
      vus,
      iterations,
      checks: ["/api/health", "/api/strategies"],
    })
  );
  process.exit(0);
}

async function oneVirtualUser(i) {
  for (let n = 0; n < iterations; n += 1) {
    const health = await fetch(`${baseUrl}/api/health`);
    if (!health.ok) throw new Error(`vu ${i} health ${health.status}`);
    const strategies = await fetch(`${baseUrl}/api/strategies`);
    if (!strategies.ok) throw new Error(`vu ${i} strategies ${strategies.status}`);
  }
}

const started = Date.now();
const results = await Promise.allSettled(
  Array.from({ length: vus }, (_, i) => oneVirtualUser(i + 1))
);
const failed = results.filter((r) => r.status === "rejected");
console.log(
  JSON.stringify({
    ok: failed.length === 0,
    baseUrl,
    vus,
    iterations,
    elapsedMs: Date.now() - started,
    failures: failed.slice(0, 10).map((f) => String(f.reason)),
  })
);
if (failed.length > 0) process.exit(1);
