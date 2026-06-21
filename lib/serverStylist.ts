import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nzTodayIso } from "@/lib/nzTime";
import type { WardrobeItem } from "@/lib/types";
import {
  inferStyleContext,
  isAvailableClothing,
  isCombinationAllowed,
  itemFormality,
  rankItemsForContext,
  stylistModeInstruction,
  stripLegacyFormalVibe,
  type StyleContext,
} from "@/lib/styleIntelligence";

export type OutfitPlan = {
  label: string;
  item_ids: string[];
  summary: string;
  why_it_works: string;
  watch_outs: string[];
  formality_score: number;
  warmth_score: number;
};

export type Recommendation = {
  day_brief: string;
  stylist_positioning: string;
  outfits: OutfitPlan[];
  missing_info: string[];
};

export type RecommendInput = {
  profileId?: string;
  dayContext?: string;
  weather?: string;
  vibe?: string;
  selectedDate?: string;
  bodyId?: string;
  sessionId?: string;
};

const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["day_brief", "stylist_positioning", "outfits", "missing_info"],
  properties: {
    day_brief: { type: "string" },
    stylist_positioning: { type: "string" },
    missing_info: { type: "array", items: { type: "string" } },
    outfits: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "item_ids", "summary", "why_it_works", "watch_outs", "formality_score", "warmth_score"],
        properties: {
          label: { type: "string" },
          item_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 7 },
          summary: { type: "string" },
          why_it_works: { type: "string" },
          watch_outs: { type: "array", items: { type: "string" } },
          formality_score: { type: "integer", minimum: 1, maximum: 10 },
          warmth_score: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
  },
} as const;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");
  return new OpenAI({ apiKey });
}

function getOutputText(response: unknown) {
  const r = response as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof r.output_text === "string" && r.output_text.trim()) return r.output_text;
  for (const output of r.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
      if (typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  throw new Error("The stylist model returned no text output.");
}

function compactItem(item: WardrobeItem) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    brand: item.brand,
    colour: item.colour_primary || item.colour,
    pattern: item.pattern,
    fabric: item.fabric_guess,
    season_tags: item.season_tags,
    formality: item.formality,
    formality_score: item.formality_score,
    inferred_formality_score: itemFormality(item),
    warmth_score: item.warmth_score,
    weather_suitability: item.weather_suitability,
    style_tags: item.style_tags,
    laundry_status: item.laundry_status,
    fit_status: item.fit_status,
    angle_count: item.angle_count,
    summary: item.ai_summary,
  };
}

function average(items: WardrobeItem[], field: "formality_score" | "warmth_score", fallback: number) {
  if (!items.length) return fallback;
  return Math.max(1, Math.min(10, Math.round(items.reduce((sum, item) => sum + (item[field] ?? fallback), 0) / items.length)));
}

function buildLook(label: string, items: WardrobeItem[], context: StyleContext): OutfitPlan {
  const selected = items.filter(Boolean);
  const formality = selected.length ? Math.round(selected.reduce((sum, item) => sum + itemFormality(item), 0) / selected.length) : context.formalityCeiling;
  return {
    label,
    item_ids: selected.map((item) => item.id),
    summary: selected.map((item) => item.name).join(" + ") || "Upload more wardrobe pieces",
    why_it_works: context.reason,
    watch_outs: isCombinationAllowed(selected, context) ? [] : ["This combination was adjusted because some pieces clashed in formality or style."],
    formality_score: Math.min(context.formalityCeiling, formality),
    warmth_score: average(selected, "warmth_score", 4),
  };
}

function category(items: WardrobeItem[], name: WardrobeItem["category"]) {
  return items.filter((item) => item.category === name);
}

function findOutfitCombinations(ranked: WardrobeItem[], context: StyleContext) {
  const tops = category(ranked, "top").slice(0, 10);
  const bottoms = category(ranked, "bottom").slice(0, 10);
  const shoes = category(ranked, "shoes").slice(0, 10);
  const outerwear = category(ranked, "outerwear").slice(0, 8);
  const accessories = category(ranked, "accessory").slice(0, 8);
  const looks: WardrobeItem[][] = [];

  const topPool = tops.length ? tops : ranked.slice(0, 6);
  const bottomPool = bottoms.length ? bottoms : ranked.filter((item) => item.category !== "top").slice(0, 6);
  const shoePool = shoes.length ? shoes : [];
  const outerPool = [undefined, ...outerwear] as Array<WardrobeItem | undefined>;
  const accessoryPool = [undefined, ...accessories] as Array<WardrobeItem | undefined>;

  for (const top of topPool) {
    for (const bottom of bottomPool) {
      for (const shoe of shoePool.length ? shoePool : [undefined]) {
        for (const outer of outerPool) {
          for (const accessory of accessoryPool) {
            const outfit = [top, bottom, shoe, outer, accessory].filter(Boolean) as WardrobeItem[];
            const ids = new Set(outfit.map((item) => item.id));
            if (ids.size !== outfit.length) continue;
            if (outfit.length < 2) continue;
            if (!isCombinationAllowed(outfit, context)) continue;
            const avgFormality = outfit.reduce((sum, item) => sum + itemFormality(item), 0) / outfit.length;
            if (avgFormality > context.formalityCeiling + 0.35) continue;
            looks.push(outfit);
            if (looks.length >= 2) return looks;
          }
        }
      }
    }
  }

  return looks.length ? looks : [ranked.slice(0, Math.min(5, ranked.length))];
}

export function fallbackRecommendation(items: WardrobeItem[], input: RecommendInput): Recommendation {
  const context = inferStyleContext({ dayContext: input.dayContext, weather: input.weather, vibe: input.vibe });
  const ranked = rankItemsForContext(items, context);
  const combos = findOutfitCombinations(ranked, context);
  const outfits = combos.map((combo, index) => buildLook(index === 0 ? "Look A" : "Look B", combo, context)).slice(0, 2);

  while (outfits.length < 2 && ranked.length >= 2) {
    const offset = outfits.length;
    const used = new Set(outfits.flatMap((look) => look.item_ids));
    const next = ranked.filter((item) => !used.has(item.id)).slice(0, 5);
    if (next.length < 2) break;
    outfits.push(buildLook(offset === 0 ? "Look A" : "Look B", next, context));
  }

  return {
    day_brief: [input.dayContext, input.weather].filter(Boolean).join(" · ") || "Today’s practical wardrobe brief.",
    stylist_positioning: `${context.label}: ${context.reason} Formality target ${context.formalityCeiling}/10 or lower unless you explicitly ask otherwise.`,
    missing_info: outfits.length < 2 ? ["Upload more complete wardrobe pieces to improve the recommendations."] : [],
    outfits,
  };
}

export function keepOnlyValidIds(recommendation: Recommendation, usable: WardrobeItem[]): Recommendation {
  const validIds = new Set(usable.map((item) => item.id));
  return {
    ...recommendation,
    outfits: recommendation.outfits
      .slice(0, 2)
      .map((outfit, index) => ({
        ...outfit,
        label: index === 0 ? "Look A" : "Look B",
        item_ids: outfit.item_ids.filter((id) => validIds.has(id)).slice(0, 7),
      }))
      .filter((outfit) => outfit.item_ids.length >= 2),
  };
}

function recommendationBreaksContext(recommendation: Recommendation, usable: WardrobeItem[], context: StyleContext) {
  const byId = new Map(usable.map((item) => [item.id, item]));
  return recommendation.outfits.some((outfit) => {
    const selected = outfit.item_ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
    if (!selected.length) return true;
    const avgFormality = selected.reduce((sum, item) => sum + itemFormality(item), 0) / selected.length;
    if (avgFormality > context.formalityCeiling + 0.35) return true;
    if ((outfit.formality_score ?? 5) > context.formalityCeiling) return true;
    return !isCombinationAllowed(selected, context);
  });
}

export async function recommendOutfits(input: RecommendInput) {
  const supabaseAdmin = getSupabaseAdmin();
  let profileName = "Manny";
  let profileStyle = "Practical, personal, Auckland-weather aware. Match the actual day context rather than forcing formality.";

  if (input.profileId) {
    const { data: profile } = await supabaseAdmin
      .from("wardrobe_profiles")
      .select("display_name, style_profile")
      .eq("id", input.profileId)
      .maybeSingle();
    if (profile?.display_name) profileName = profile.display_name;
    if (profile?.style_profile) profileStyle = profile.style_profile;
  }

  let query = supabaseAdmin
    .from("wardrobe_items")
    .select("*")
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (input.profileId) query = query.eq("profile_id", input.profileId);

  const { data, error } = await query;
  if (error) throw error;

  const items = (data ?? []) as WardrobeItem[];
  const usable = items.filter(isAvailableClothing);
  const context = inferStyleContext({ dayContext: input.dayContext, weather: input.weather, vibe: input.vibe });

  let recommendation: Recommendation;
  if (usable.length < 2) {
    recommendation = fallbackRecommendation(items, input);
  } else {
    const ranked = rankItemsForContext(usable, context);
    const modelItems = ranked.slice(0, 70);
    const cleanedVibe = stripLegacyFormalVibe(input.vibe, input.dayContext);
    const profileGuidance = context.mode === "formal"
      ? profileStyle
      : "Use the profile for colour, fit and personality only. The occasion/calendar/weather wins over any saved corporate or executive wording.";
    const prompt = `You are Wardrobe Concierge's senior personal stylist and fashion editor. Be visual, practical and tasteful, not corporate by default.

Dress ${profileName} using ONLY item IDs from the wardrobe JSON. Return exactly 2 looks: Look A and Look B.

CONTEXT CLASSIFICATION: ${context.label.toUpperCase()}
WHY: ${context.reason}
FORMALITY CEILING: ${context.formalityCeiling}/10 unless the user explicitly asks for formal dress code.
ALLOW FULL SUIT: ${context.allowSuit ? "yes" : "no"}
CAMERA AWARE: ${context.cameraAware ? "yes" : "no"}
Styling instruction: ${stylistModeInstruction(context)}
Profile guidance: ${profileGuidance}
Date: ${input.selectedDate || nzTodayIso()}
Day/calendar context: ${input.dayContext || "No calendar context supplied."}
Weather context: ${input.weather || "No weather context supplied."}
Explicit style preference: ${cleanedVibe || "none"}

Non-negotiable rules:
- The user's actual day and calendar beat saved profile style.
- Online meetings do NOT mean full suit. Dress camera-smart but comfortable.
- Never pair a Burton/sport/gym/logo hoodie or sweatshirt with pinstripe suit pieces, formal suit trousers, or a formal suit jacket.
- Do not create novelty clashing combinations. Be creative through texture, colour, layers and proportion, not random mixing.
- Use only available item IDs from the JSON.
- Do not choose body_reference items.
- Do not choose needs_wash, drying or unavailable items.
- Prefer complete outfits: top + bottom + shoes, with outerwear/accessory when useful.
- Treat multiple photo angles as one item, not duplicates.
- Keep text short; the UI is visual.
- If the context is online work, prefer smart knit/cardigan/quarter zip/polo/clean overshirt and avoid tie/full suit.
- If the context is Sunday/weekend/family/errands, the look must be relaxed and family practical.

Available wardrobe items JSON, already ranked for context:
${JSON.stringify(modelItems.map(compactItem), null, 2)}`;

    try {
      const response = await getOpenAI().responses.create({
        model: process.env.OPENAI_VISION_MODEL || "gpt-5-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        text: {
          format: {
            type: "json_schema",
            name: "wardrobe_two_outfits",
            schema: recommendationSchema,
            strict: true,
          },
        },
      } as never);
      recommendation = keepOnlyValidIds(JSON.parse(getOutputText(response)), usable);
      if (recommendation.outfits.length < 2 || recommendationBreaksContext(recommendation, usable, context)) {
        recommendation = fallbackRecommendation(items, input);
      }
    } catch (aiError) {
      console.error("AI recommendation failed; using fallback", aiError);
      recommendation = fallbackRecommendation(items, input);
    }
  }

  return { recommendation, items };
}

export async function saveStylistSession(input: RecommendInput, recommendation: Recommendation) {
  if (!input.profileId) return input.sessionId || "";
  const supabaseAdmin = getSupabaseAdmin();
  const sessionPayload = {
    owner_id: "demo-user",
    profile_id: input.profileId,
    selected_date: input.selectedDate || nzTodayIso(),
    day_context: input.dayContext || null,
    weather_summary: input.weather || null,
    desired_vibe: stripLegacyFormalVibe(input.vibe, input.dayContext) || null,
    active_body_item_id: input.bodyId || null,
    draft_prompt: input.dayContext || null,
    last_recommendation: recommendation,
    updated_at: new Date().toISOString(),
  };

  const saved = input.sessionId
    ? await supabaseAdmin.from("stylist_sessions").update(sessionPayload).eq("id", input.sessionId).select("id").single()
    : await supabaseAdmin.from("stylist_sessions").insert(sessionPayload).select("id").single();

  if (!saved.error && saved.data?.id) return saved.data.id as string;
  return input.sessionId || "";
}
