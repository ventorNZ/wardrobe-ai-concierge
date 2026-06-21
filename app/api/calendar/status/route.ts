import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCalendarOwnerId, listCalendarConnections, setCalendarOwnerCookie } from "@/lib/calendarProviders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get("profileId") || "";
  const ownerId = getOrCreateCalendarOwnerId(request);
  if (!profileId) {
    return setCalendarOwnerCookie(NextResponse.json({ ok: false, connected: false, connections: [], error: "Missing profileId" }, { status: 400 }), ownerId);
  }
  try {
    const connections = await listCalendarConnections(profileId, ownerId);
    return setCalendarOwnerCookie(NextResponse.json({
      ok: true,
      connected: connections.length > 0,
      connections: connections.map((connection) => ({
        provider: connection.provider,
        email: connection.email,
        updated_at: connection.updated_at,
        expires_at: connection.expires_at,
      })),
      connect: {
        google: `/api/calendar/connect?provider=google&profileId=${encodeURIComponent(profileId)}`,
        outlook: `/api/calendar/connect?provider=outlook&profileId=${encodeURIComponent(profileId)}`,
      },
    }), ownerId);
  } catch (error) {
    return setCalendarOwnerCookie(NextResponse.json({ ok: false, connected: false, connections: [], error: error instanceof Error ? error.message : "Calendar status failed" }, { status: 500 }), ownerId);
  }
}
