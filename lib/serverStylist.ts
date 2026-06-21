import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nzTodayIso } from "@/lib/nzTime";
import type { WardrobeItem } from "@/lib/types";

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

function buildLook(label: string, items: WardrobeItem[]): OutfitPlan {
  return {
    label,
    item_ids: items.map((item) => item.id),
    summary: items.map((item) => item.name).join(" + ") || "Upload more wardrobe pieces",
    why_it_works: "This look uses only available wardrobe items and avoids anything marked needs wash, drying or unavailable.",
    watch_outs: [],
    formality_score: average(items, "formality_score", 5),
    warmth_score: average(items, "warmth_score", 4),
  };
}

export function fallbackRecommendation(items: WardrobeItem[], input: RecommendInput): Recommendation {
  const available = items.filter((item) => item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean"));
  const byCategory = (category: WardrobeItem["category"]) => available.filter((item) => item.category === category);
  const tops = byCategory("top");
  const bottoms = byCategory("bottom");
  const shoes = byCategory("shoes");
  const outerwear = byCategory("outerwear");
  const accessories = byCategory("accessory");
  const make = (label: string, offset: number) => [
    tops[offset % Math.max(tops.length, 1)],
    bottoms[offset % Math.max(bottoms.length, 1)],
    shoes[offset % Math.max(shoes.length, 1)],
    outerwear[offset % Math.max(outerwear.length, 1)],
    accessories[offset % Math.max(accessories.length, 1)],
  ].filter(Boolean) as WardrobeItem[];

  const outfits = [buildLook("Look A", make("Look A", 0)), buildLook("Look B", make("Look B", 1))]
    .filter((look) => look.item_ids.length >= 2)
    .slice(0, 2);

  return {
    day_brief: [input.dayContext, input.weather].filter(Boolean).join(" · ") || "Today’s practical wardrobe brief.",
    stylist_positioning: "Two quick outfit options based on available wardrobe data.",
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

export async function recommendOutfits(input: RecommendInput) {
  const supabaseAdmin = getSupabaseAdmin();
  let profileName = "Manny";
  let profileStyle = "Modern, polished, practical, Auckland-weather aware.";

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
  const usable = items.filter((item) => item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean"));

  let recommendation: Recommendation;
  if (usable.length < 2) {
    recommendation = fallbackRecommendation(items, input);
  } else {
    const prompt = `You are Wardrobe Concierge's senior personal stylist. Be visual, direct and practical.

Dress ${profileName} using ONLY item IDs from the wardrobe JSON. Return exactly 2 looks: Look A and Look B.

Profile style: ${profileStyle}
Date: ${input.selectedDate || nzTodayIso()}
Day/calendar context: ${input.dayContext || "No calendar context supplied."}
Weather context: ${input.weather || "No weather context supplied."}
Desired vibe: ${input.vibe || "Polished, modern, comfortable."}

Rules:
- Do not invent clothing.
- Use only available item IDs.
- Do not choose body_reference items.
- Do not choose needs_wash, drying or unavailable items.
- Prefer complete outfits: top + bottom + shoes, with outerwear/accessory when useful.
- Treat multiple photo angles as one item, not duplicates.
- Keep text short; the UI is visual.

Available wardrobe items JSON:
${JSON.stringify(usable.map(compactItem), null, 2)}`;

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
      if (recommendation.outfits.length < 2) recommendation = fallbackRecommendation(items, input);
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
    desired_vibe: input.vibe || null,
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
