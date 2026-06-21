import { NextRequest, NextResponse } from "next/server";
import { nzTodayIso } from "@/lib/nzTime";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId") || "";
  const date = searchParams.get("date") || nzTodayIso();

  return NextResponse.json({
    ok: true,
    profileId,
    date,
    connected: false,
    provider: null,
    context: "No calendar connected yet. Calendar hook is ready for Gmail/Google Calendar, Outlook/Microsoft Graph, or uploaded calendar events per wardrobe profile.",
    next_steps: [
      "Store calendar provider per wardrobe profile.",
      "Fetch that profile's events for the selected NZ date.",
      "Summarise only wardrobe-relevant context: meetings, school run, travel, outside time, formality and physical activity.",
    ],
  });
}
