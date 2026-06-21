import { NextRequest, NextResponse } from "next/server";
import { nzTodayIso } from "@/lib/nzTime";
import {
  fetchGoogleEvents,
  fetchOutlookEvents,
  listCalendarConnections,
  summariseCalendarEvents,
  type CalendarEventLite,
} from "@/lib/calendarProviders";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId") || "";
  const date = searchParams.get("date") || nzTodayIso();

  if (!profileId) {
    return NextResponse.json({ ok: false, connected: false, context: "No profile selected yet." }, { status: 400 });
  }

  try {
    const connections = await listCalendarConnections(profileId);
    if (!connections.length) {
      return NextResponse.json({
        ok: true,
        profileId,
        date,
        connected: false,
        providers: [],
        context: "No calendar connected yet. Connect Google Calendar or Outlook so the stylist can tell online meetings from in-person plans.",
        connect: {
          google: `/api/calendar/connect?provider=google&profileId=${encodeURIComponent(profileId)}`,
          outlook: `/api/calendar/connect?provider=outlook&profileId=${encodeURIComponent(profileId)}`,
        },
      });
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

    return NextResponse.json({
      ok: true,
      profileId,
      date,
      connected: true,
      providers: connections.map((connection) => connection.provider),
      events,
      context: summariseCalendarEvents(events),
      failures,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      profileId,
      date,
      connected: false,
      context: "Calendar integration is not fully configured yet. Add today’s meetings in the brief; the stylist will treat online meetings as smart-casual, not full suit.",
      error: error instanceof Error ? error.message : "Calendar unavailable",
      connect: {
        google: `/api/calendar/connect?provider=google&profileId=${encodeURIComponent(profileId)}`,
        outlook: `/api/calendar/connect?provider=outlook&profileId=${encodeURIComponent(profileId)}`,
      },
    });
  }
}
