import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateCalendarOwnerId,
  googleAuthUrl,
  outlookAuthUrl,
  setCalendarOwnerCookie,
} from "@/lib/calendarProviders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const provider = request.nextUrl.searchParams.get("provider") || "google";
    const profileId = request.nextUrl.searchParams.get("profileId") || "";
    const returnTo = request.nextUrl.searchParams.get("returnTo") || "/planner";
    if (!profileId) return NextResponse.json({ error: "Missing profileId" }, { status: 400 });

    const ownerId = getOrCreateCalendarOwnerId(request);
    let redirectUrl = "";
    if (provider === "google") redirectUrl = googleAuthUrl(request.url, profileId, ownerId, returnTo);
    else if (provider === "outlook") redirectUrl = outlookAuthUrl(request.url, profileId, ownerId, returnTo);
    else return NextResponse.json({ error: "Unsupported calendar provider" }, { status: 400 });

    return setCalendarOwnerCookie(NextResponse.redirect(redirectUrl), ownerId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar connection failed" }, { status: 500 });
  }
}
