import { NextRequest, NextResponse } from "next/server";
import { nzTodayIso } from "@/lib/nzTime";
import {
  fetchGoogleEvents,
  fetchOutlookEvents,
  getOrCreateCalendarOwnerId,
  listCalendarConnections,
  setCalendarOwnerCookie,
  summariseCalendarEvents,
  type CalendarEventLite,
} from "@/lib/calendarProviders";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId") || "";
  const date = searchParams.get("date") || nzTodayIso();
  const ownerId = getOrCreateCalendarOwnerId(request);

  if (!profileId) {
    return setCalendarOwnerCookie(NextResponse.json({ ok: false, connected: false, context: "No profile selected yet." }, { status: 400 }), ownerId);
  }

  try {
    const connections = await listCalendarConnections(profileId, ownerId);
    if (!connections.length) {
      return setCalendarOwnerCookie(NextResponse.json({
        ok: true,
        profileId,
        date,
        connected: false,
        providers: [],
        connections: [],
        context: "No calendar connected yet. Connect Google Calendar or Outlook so the stylist can tell online meetings from in-person plans.",
        connect: {
          google: `/api/calendar/connect?provider=google&profileId=${encodeURIComponent(profileId)}`,
          outlook: `/api/calendar/connect?provider=outlook&profileId=${encodeURIComponent(profileId)}`,
        },
      }), ownerId);
    }

    const events: CalendarEventLite[] = [];
    const failures: string[] = [];
    for (const connection of connections) {
      try {
        if (connection.provider === "google") events.push(...await fetchGoogleEvents(connection, date));
        if (connection.provider === "outlook") events.push(...await fetchOutlookEvents(connection, date));
      } catch (error) {
        failures.push(`${connection.provider}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }

    return setCalendarOwnerCookie(NextResponse.json({
      ok: true,
      profileId,
      date,
      connected: true,
      providers: connections.map((connection) => connection.provider),
      connections: connections.map((connection) => ({ provider: connection.provider, email: connection.email, updated_at: connection.updated_at })),
      events,
      context: summariseCalendarEvents(events),
      failures,
      connect: {
        google: `/api/calendar/connect?provider=google&profileId=${encodeURIComponent(profileId)}`,
        outlook: `/api/calendar/connect?provider=outlook&profileId=${encodeURIComponent(profileId)}`,
      },
    }), ownerId);
  } catch (error) {
    return setCalendarOwnerCookie(NextResponse.json({
      ok: true,
      profileId,
      date,
      connected: false,
      context: "Calendar integration is not configured yet. Add today’s meetings in the brief; online/internal meetings are treated as smart-casual, not full suit.",
      error: error instanceof Error ? error.message : "Calendar unavailable",
      connect: {
        google: `/api/calendar/connect?provider=google&profileId=${encodeURIComponent(profileId)}`,
        outlook: `/api/calendar/connect?provider=outlook&profileId=${encodeURIComponent(profileId)}`,
      },
    }), ownerId);
  }
}
