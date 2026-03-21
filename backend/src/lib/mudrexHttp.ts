import { NextResponse } from "next/server";
import { MudrexAPIError } from "@/lib/mudrex";

/** Map Mudrex client errors to JSON API responses (429, 503, etc.). */
export function jsonFromMudrexError(error: unknown): NextResponse | null {
  if (!(error instanceof MudrexAPIError)) return null;
  const status =
    error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
  const body: Record<string, unknown> = { error: error.message };
  if (status === 429) body.code = "MUDREX_RATE_LIMIT";
  if (status === 503) body.code = "MUDREX_UNAVAILABLE";
  return NextResponse.json(body, { status });
}
