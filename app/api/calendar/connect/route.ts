import { NextRequest, NextResponse } from "next/server";
import { googleAuthUrl, outlookAuthUrl } from "@/lib/calendarProviders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const provider = request.nextUrl.searchParams.get("provider") || "google";
    const profileId = request.nextUrl.searchParams.get("profileId") || "";
    if (!profileId) return NextResponse.json({ error: "Missing profileId" }, { status: 400 });
    if (provider === "google") return NextResponse.redirect(googleAuthUrl(request.url, profileId));
    if (provider === "outlook") return NextResponse.redirect(outlookAuthUrl(request.url, profileId));
    return NextResponse.json({ error: "Unsupported calendar provider" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar connection failed" }, { status: 500 });
  }
}
