import { NextRequest, NextResponse } from "next/server";
import { exchangeOutlookCode, parseCalendarState, saveCalendarConnection } from "@/lib/calendarProviders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = parseCalendarState(request.nextUrl.searchParams.get("state"));
    if (!code) throw new Error("Missing Microsoft OAuth code");
    const token = await exchangeOutlookCode(request.url, code);
    await saveCalendarConnection(state.profileId, "outlook", token);
    return NextResponse.redirect(new URL("/planner?calendar=connected", request.url));
  } catch (error) {
    const url = new URL("/planner", request.url);
    url.searchParams.set("calendar_error", error instanceof Error ? error.message : "Outlook calendar connection failed");
    return NextResponse.redirect(url);
  }
}
