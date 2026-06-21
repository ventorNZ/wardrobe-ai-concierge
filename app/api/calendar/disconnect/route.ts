import { NextRequest, NextResponse } from "next/server";
import { disconnectCalendarConnection, getOrCreateCalendarOwnerId, setCalendarOwnerCookie, type CalendarProvider } from "@/lib/calendarProviders";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ownerId = getOrCreateCalendarOwnerId(request);
  try {
    const body = await request.json().catch(() => ({}));
    const profileId = String(body.profileId || "");
    const provider = body.provider === "google" || body.provider === "outlook" ? body.provider as CalendarProvider : undefined;
    if (!profileId) return setCalendarOwnerCookie(NextResponse.json({ ok: false, error: "Missing profileId" }, { status: 400 }), ownerId);
    await disconnectCalendarConnection(profileId, ownerId, provider);
    return setCalendarOwnerCookie(NextResponse.json({ ok: true }), ownerId);
  } catch (error) {
    return setCalendarOwnerCookie(NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Disconnect failed" }, { status: 500 }), ownerId);
  }
}
