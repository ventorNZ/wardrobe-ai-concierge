import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { OutfitPlan } from "@/lib/serverStylist";
import type { WardrobeItem } from "@/lib/types";
import {
  inferStyleContext,
  isAvailableClothing,
  isCombinationAllowed,
  scoreSwapCandidate,
  swapReason,
} from "@/lib/styleIntelligence";

export const runtime = "nodejs";
export const maxDuration = 30;

type CandidateRequest = {
  profileId?: string;
  outfit: OutfitPlan;
  sourceItemId: string;
  dayContext?: string;
  calendarContext?: string;
  vibe?: string;
  weather?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CandidateRequest;
    if (!body.outfit?.item_ids?.length) return NextResponse.json({ error: "Missing outfit" }, { status: 400 });
    if (!body.sourceItemId) return NextResponse.json({ error: "Missing source item" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from("wardrobe_items")
      .select("*")
      .eq("is_archived", false)
      .order("created_at", { ascending: false });
    if (body.profileId) query = query.eq("profile_id", body.profileId);

    const { data, error } = await query;
    if (error) throw error;

    const items = (data ?? []) as WardrobeItem[];
    const byId = new Map(items.map((item) => [item.id, item]));
    const source = byId.get(body.sourceItemId);
    if (!source) return NextResponse.json({ error: "Source item not found" }, { status: 404 });

    const currentOutfit = body.outfit.item_ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
    const currentIds = new Set(currentOutfit.map((item) => item.id));
    const context = inferStyleContext({
      dayContext: [body.calendarContext, body.dayContext].filter(Boolean).join("\n"),
      weather: body.weather,
      vibe: body.vibe,
    });

    const candidates = items
      .filter(isAvailableClothing)
      .filter((item) => item.id !== source.id)
      .filter((item) => item.category === source.category)
      .filter((item) => !currentIds.has(item.id))
      .map((item) => {
        const trial = currentOutfit.map((current) => (current.id === source.id ? item : current));
        const compatible = isCombinationAllowed(trial, context);
        const score = scoreSwapCandidate(item, currentOutfit, source, context);
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          image_url: item.image_url,
          score,
          compatible,
          reason: compatible ? swapReason(item, source, context) : "Possible mismatch with the rest of the outfit; choose only if you want that contrast.",
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 18);

    return NextResponse.json({
      ok: true,
      source: { id: source.id, name: source.name, category: source.category },
      context: { mode: context.mode, label: context.label, formalityCeiling: context.formalityCeiling, reason: context.reason },
      suggestedId: candidates.find((candidate) => candidate.compatible)?.id || candidates[0]?.id || null,
      candidates,
    });
  } catch (error) {
    console.error("/api/swap-candidates failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load swap choices" }, { status: 500 });
  }
}
