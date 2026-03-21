import { NextResponse } from "next/server";
import {
  getSessionMaxAgeDays,
  MUDREX_API_KEY_MAX_DAYS,
} from "@/lib/auth";

/** Public hints for the sign-in UI (no secrets). */
export async function GET() {
  return NextResponse.json({
    sessionMaxAgeDays: getSessionMaxAgeDays(),
    mudrexKeyMaxDays: MUDREX_API_KEY_MAX_DAYS,
  });
}
