import { NextRequest, NextResponse } from "next/server";
import { recommendOutfits, saveStylistSession, type RecommendInput } from "@/lib/serverStylist";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as RecommendInput;
    const { recommendation } = await recommendOutfits(input);
    const sessionId = await saveStylistSession(input, recommendation);
    return NextResponse.json({ ok: true, recommendation, sessionId });
  } catch (error) {
    console.error("/api/recommend-outfits failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Recommendation failed" },
      { status: 500 },
    );
  }
}
