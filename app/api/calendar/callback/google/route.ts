import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, parseCalendarState, saveCalendarConnection, setCalendarOwnerCookie } from "@/lib/calendarProviders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("Missing Google OAuth code");
    const state = parseCalendarState(request.nextUrl.searchParams.get("state"));
    const token = await exchangeGoogleCode(request.url, code);
    await saveCalendarConnection(state.ownerId, state.profileId, "google", token);
    const redirectUrl = new URL(state.returnTo || "/planner", request.url);
    redirectUrl.searchParams.set("calendar", "connected");
    redirectUrl.searchParams.set("provider", "google");
    return setCalendarOwnerCookie(NextResponse.redirect(redirectUrl), state.ownerId);
  } catch (error) {
    const redirectUrl = new URL("/planner", request.url);
    redirectUrl.searchParams.set("calendar", "error");
    redirectUrl.searchParams.set("message", error instanceof Error ? error.message : "Google calendar failed");
    return NextResponse.redirect(redirectUrl);
  }
}
