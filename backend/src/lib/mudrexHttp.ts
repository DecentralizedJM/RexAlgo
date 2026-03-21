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
  if (status === 401) {
    body.code = "MUDREX_API_KEY_INVALID";
    body.hint =
      "Mudrex API keys typically expire after about 90 days. Generate or rotate your key at https://mudrex.com/pro-trading then reconnect at Sign in — your strategies and history stay under the same RexAlgo profile.";
  }
  return NextResponse.json(body, { status });
}
