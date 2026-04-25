import { NextRequest, NextResponse } from "next/server";
import { enforceBodyLimit } from "@/lib/bodyLimit";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES = new Set([
  "react_error",
  "unhandled_error",
  "unhandled_rejection",
  "api_error",
  "web_vital",
]);

export async function POST(req: NextRequest) {
  const tooLarge = enforceBodyLimit(req, 32 * 1024);
  if (tooLarge) return tooLarge;

  let body: {
    type?: unknown;
    message?: unknown;
    route?: unknown;
    requestId?: unknown;
    data?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type : "unknown";
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "Unsupported event type" }, { status: 400 });
  }

  logger.warn(
    {
      type,
      message:
        typeof body.message === "string" ? body.message.slice(0, 500) : undefined,
      route: typeof body.route === "string" ? body.route.slice(0, 200) : undefined,
      requestId:
        typeof body.requestId === "string" ? body.requestId.slice(0, 128) : undefined,
      data: body.data,
    },
    "[client-event]"
  );

  return NextResponse.json({ ok: true });
}
