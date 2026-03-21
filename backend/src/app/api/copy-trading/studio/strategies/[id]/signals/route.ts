import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  strategies,
  copySignalEvents,
  copyMirrorAttempts,
} from "@/lib/schema";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: strategyId } = await ctx.params;

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.id, strategyId),
        eq(strategies.creatorId, session.user.id),
        eq(strategies.type, "copy_trading")
      )
    );

  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const signals = await db
    .select()
    .from(copySignalEvents)
    .where(eq(copySignalEvents.strategyId, strategyId))
    .orderBy(desc(copySignalEvents.receivedAt))
    .limit(50);

  const ids = signals.map((s) => s.id);
  let attemptRows: { signalId: string; status: string }[] = [];
  if (ids.length > 0) {
    attemptRows = await db
      .select({
        signalId: copyMirrorAttempts.signalId,
        status: copyMirrorAttempts.status,
      })
      .from(copyMirrorAttempts)
      .where(inArray(copyMirrorAttempts.signalId, ids));
  }

  const counts = new Map<string, { ok: number; err: number }>();
  for (const a of attemptRows) {
    const c = counts.get(a.signalId) ?? { ok: 0, err: 0 };
    if (a.status === "ok") c.ok++;
    else c.err++;
    counts.set(a.signalId, c);
  }

  const signalsOut = signals.map((s) => {
    let payload: unknown = s.payloadJson;
    try {
      payload = JSON.parse(s.payloadJson) as unknown;
    } catch {
      /* keep raw string */
    }
    return {
      id: s.id,
      idempotencyKey: s.idempotencyKey,
      receivedAt: s.receivedAt,
      clientIp: s.clientIp,
      payload,
      mirror: counts.get(s.id) ?? { ok: 0, err: 0 },
    };
  });

  return NextResponse.json({ signals: signalsOut });
}
