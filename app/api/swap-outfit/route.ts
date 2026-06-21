import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { OutfitPlan } from "@/lib/serverStylist";
import type { WardrobeItem } from "@/lib/types";
import {
  inferStyleContext,
  isAvailableClothing,
  isCombinationAllowed,
  itemFormality,
  scoreSwapCandidate,
  swapReason,
} from "@/lib/styleIntelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

type SwapRequest = {
  profileId?: string;
  outfit: OutfitPlan;
  swapItemIds: string[];
  manualReplacements?: Record<string, string>;
  dayContext?: string;
  calendarContext?: string;
  vibe?: string;
  weather?: string;
};

function average(items: WardrobeItem[], field: "formality_score" | "warmth_score", fallback: number) {
  if (!items.length) return fallback;
  return Math.max(1, Math.min(10, Math.round(items.reduce((sum, item) => sum + (item[field] ?? fallback), 0) / items.length)));
}

function rankCandidates(source: WardrobeItem, currentOutfit: WardrobeItem[], allItems: WardrobeItem[], body: SwapRequest) {
  const context = inferStyleContext({
    dayContext: [body.calendarContext, body.dayContext].filter(Boolean).join("\n"),
    weather: body.weather,
    vibe: body.vibe,
  });
  const currentIds = new Set(currentOutfit.map((item) => item.id));
  return allItems
    .filter(isAvailableClothing)
    .filter((item) => item.id !== source.id)
    .filter((item) => item.category === source.category)
    .filter((item) => !currentIds.has(item.id))
    .map((item) => ({ item, score: scoreSwapCandidate(item, currentOutfit, source, context) }))
    .sort((a, b) => b.score - a.score);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SwapRequest;
    if (!body.outfit?.item_ids?.length) return NextResponse.json({ error: "Missing outfit" }, { status: 400 });
    if (!body.swapItemIds?.length) return NextResponse.json({ error: "Choose items to swap" }, { status: 400 });

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
    const originalOutfit = body.outfit.item_ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
    const context = inferStyleContext({
      dayContext: [body.calendarContext, body.dayContext].filter(Boolean).join("\n"),
      weather: body.weather,
      vibe: body.vibe,
    });

    let currentIds = [...body.outfit.item_ids];
    const replaced: string[] = [];
    const reasoning: string[] = [];

    for (const sourceId of body.swapItemIds) {
      const source = byId.get(sourceId);
      if (!source) continue;

      const manualId = body.manualReplacements?.[sourceId];
      const currentOutfit = currentIds.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
      let chosen: WardrobeItem | undefined;

      if (manualId) {
        const manual = byId.get(manualId);
        if (manual && isAvailableClothing(manual) && manual.category === source.category && !currentIds.includes(manual.id)) chosen = manual;
      }

      if (!chosen) {
        const candidates = rankCandidates(source, currentOutfit, items, body);
        chosen = candidates.find((candidate) => {
          const trial = currentOutfit.map((item) => (item.id === source.id ? candidate.item : item));
          return candidate.score > -20 && isCombinationAllowed(trial, context);
        })?.item;
      }

      if (!chosen) continue;
      currentIds = currentIds.map((id) => (id === sourceId ? chosen!.id : id));
      replaced.push(`${source.name} → ${chosen.name}`);
      reasoning.push(swapReason(chosen, source, context));
    }

    const selected = currentIds.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
    const incompatible = !isCombinationAllowed(selected, context);
    const newOutfit: OutfitPlan = {
      ...body.outfit,
      item_ids: currentIds,
      summary: selected.map((item) => item.name).join(" + ") || body.outfit.summary,
      why_it_works: replaced.length
        ? `Changed ${replaced.join(", ")}. ${Array.from(new Set(reasoning)).slice(0, 2).join(" ")}`
        : "No suitable same-category replacements were found. Open the replacement picker and choose one manually.",
      watch_outs: incompatible
        ? ["This manual swap may clash in formality/style. Consider another replacement before generating the try-on."]
        : replaced.length ? [] : ["No replacement available for one or more selected items."],
      formality_score: Math.min(context.formalityCeiling, Math.round(selected.reduce((sum, item) => sum + itemFormality(item), 0) / Math.max(selected.length, 1)) || average(selected, "formality_score", 5)),
      warmth_score: average(selected, "warmth_score", 4),
    };

    return NextResponse.json({ ok: true, outfit: newOutfit, replaced, incompatible });
  } catch (error) {
    console.error("/api/swap-outfit failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Swap failed" },
      { status: 500 },
    );
  }
}
