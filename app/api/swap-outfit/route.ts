import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { OutfitPlan } from "@/lib/serverStylist";
import type { WardrobeItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type SwapRequest = {
  profileId?: string;
  outfit: OutfitPlan;
  swapItemIds: string[];
};

function available(item: WardrobeItem) {
  return item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean");
}

function scoreCandidate(candidate: WardrobeItem, currentIds: Set<string>) {
  let score = 0;
  if (!currentIds.has(candidate.id)) score += 10;
  if ((candidate.laundry_status || "clean") === "clean") score += 4;
  if ((candidate.formality_score ?? 5) >= 5) score += 1;
  if ((candidate.warmth_score ?? 4) >= 4) score += 1;
  return score;
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
    const currentIds = new Set(body.outfit.item_ids);
    const swapIds = new Set(body.swapItemIds);
    const nextIds = [...body.outfit.item_ids];
    const replaced: string[] = [];

    for (const id of body.swapItemIds) {
      const currentItem = byId.get(id);
      if (!currentItem) continue;
      const candidates = items
        .filter(available)
        .filter((item) => item.category === currentItem.category)
        .filter((item) => !currentIds.has(item.id) && !swapIds.has(item.id))
        .sort((a, b) => scoreCandidate(b, currentIds) - scoreCandidate(a, currentIds));

      const replacement = candidates[0];
      const index = nextIds.indexOf(id);
      if (replacement && index >= 0) {
        nextIds[index] = replacement.id;
        currentIds.delete(id);
        currentIds.add(replacement.id);
        replaced.push(`${currentItem.name} → ${replacement.name}`);
      }
    }

    const newOutfit: OutfitPlan = {
      ...body.outfit,
      item_ids: [...new Set(nextIds)].slice(0, 7),
      summary: byId.size ? [...new Set(nextIds)].map((id) => byId.get(id)?.name).filter(Boolean).join(" + ") : body.outfit.summary,
      why_it_works: replaced.length
        ? `Swapped ${replaced.join(", ")}. Review the updated outfit, then regenerate once.`
        : "No suitable same-category replacements were found. Try selecting a different item to swap.",
      watch_outs: replaced.length ? [] : ["No replacement available for one or more selected items."],
    };

    return NextResponse.json({ ok: true, outfit: newOutfit, replaced });
  } catch (error) {
    console.error("/api/swap-outfit failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Swap failed" },
      { status: 500 },
    );
  }
}
