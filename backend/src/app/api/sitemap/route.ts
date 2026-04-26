import { NextResponse } from "next/server";
import { db, ensureDbReady } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rexalgo.xyz";

const STATIC_ROUTES: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/marketplace", priority: "0.9", changefreq: "daily" },
  { path: "/copy-trading", priority: "0.9", changefreq: "daily" },
  { path: "/about", priority: "0.5", changefreq: "monthly" },
];

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: string) {
  return [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : "",
    priority ? `    <priority>${priority}</priority>` : "",
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function GET() {
  try {
    await ensureDbReady();

    const approvedStrategies = await db
      .select({ id: strategies.id, createdAt: strategies.createdAt })
      .from(strategies)
      .where(and(eq(strategies.status, "approved"), eq(strategies.isActive, true)));

    const today = new Date().toISOString().slice(0, 10);

    const staticEntries = STATIC_ROUTES.map((r) =>
      urlEntry(`${SITE_URL}${r.path}`, today, r.changefreq, r.priority)
    );

    const strategyEntries = approvedStrategies.map((s) => {
      const lastmod = s.createdAt ? s.createdAt.toISOString().slice(0, 10) : today;
      return urlEntry(`${SITE_URL}/strategy/${s.id}`, lastmod, "monthly", "0.8");
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticEntries,
      ...strategyEntries,
      "</urlset>",
    ].join("\n");

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[sitemap] error", err);
    return new NextResponse("Error generating sitemap", { status: 500 });
  }
}
