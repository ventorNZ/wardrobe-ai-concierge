import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WardrobeItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type RecommendBody = {
  dayContext: string;
  weather: string;
  vibe: string;
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
      minItems: 1,
      maxItems: 4,
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
          warmth_score: { type: "integer", minimum: 1, maximum: 10 }
        }
      }
    }
  }
} as const;

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
    fabric: item.fabric_guess,
    formality: item.formality,
    formality_score: item.formality_score,
    warmth_score: item.warmth_score,
    weather_suitability: item.weather_suitability,
    style_tags: item.style_tags,
    laundry_status: item.laundry_status,
    fit_status: item.fit_status,
    summary: item.ai_summary
  };
}

function fallbackRecommendation(items: WardrobeItem[], body: RecommendBody) {
  const available = items.filter((item) => item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean"));
  const top = available.find((item) => ["top", "outerwear"].includes(item.category));
  const bottom = available.find((item) => item.category === "bottom");
  const shoes = available.find((item) => item.category === "shoes");
  const accessory = available.find((item) => item.category === "accessory");
  const picked = [top, bottom, shoes, accessory].filter(Boolean) as WardrobeItem[];

  return {
    day_brief: `${body.dayContext} ${body.weather}`.trim(),
    stylist_positioning: "Clean, practical recommendation based on available wardrobe data.",
    missing_info: ["OpenAI recommendation failed, so this is a simple fallback selection."],
    outfits: [
      {
        label: "Primary",
        item_ids: picked.map((item) => item.id),
        summary: picked.map((item) => item.name).join(" + ") || "Upload more wardrobe items first",
        why_it_works: "This fallback avoids items marked needs wash, drying or unavailable. Use the AI recommendation once the API key and model are configured.",
        watch_outs: ["Fallback logic is basic"],
        formality_score: Math.round(picked.reduce((sum, item) => sum + (item.formality_score ?? 5), 0) / Math.max(picked.length, 1)),
        warmth_score: Math.round(picked.reduce((sum, item) => sum + (item.warmth_score ?? 4), 0) / Math.max(picked.length, 1))
      }
    ]
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecommendBody;
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("wardrobe_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    const items = (data ?? []) as WardrobeItem[];
    const usable = items.filter((item) => item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean"));
    if (usable.length < 2) {
      return NextResponse.json({ recommendation: fallbackRecommendation(items, body) });
    }

    const prompt = `
You are Wardrobe AI's senior personal stylist: polished, direct, practical, and fashion-literate.
You are dressing Manuel using ONLY the wardrobe item IDs provided. Do not invent items.

Personal style context:
- Modern executive, not stiff corporate unless a client/supplier meeting requires it.
- Online candidate interviews should feel approachable and modern.
- Client/supplier meetings can be more elevated.
- Auckland weather matters: cold/rain requires practical layering and shoe choice.
- Laundry matters: do not choose needs_wash, drying, or unavailable items.

Day context:
${body.dayContext || "Not specified"}

Weather/context:
${body.weather || "Not specified"}

Desired vibe:
${body.vibe || "Not specified"}

Available wardrobe items as JSON:
${JSON.stringify(usable.map(compactItem), null, 2)}

Return 2 to 4 outfits. Each outfit should include a balanced set of items: ideally top/outerwear + bottom + shoes + accessory if available. Use only IDs from the list.
`.trim();

    try {
      const response = await openai.responses.create({
        model: process.env.OPENAI_VISION_MODEL || "gpt-5-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        text: {
          format: {
            type: "json_schema",
            name: "wardrobe_outfit_recommendation",
            schema: recommendationSchema,
            strict: true
          }
        }
      } as never);

      const raw = getOutputText(response);
      const parsed = JSON.parse(raw);
      return NextResponse.json({ recommendation: parsed });
    } catch (aiError) {
      console.error(aiError);
      return NextResponse.json({ recommendation: fallbackRecommendation(items, body) });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recommendation failed" },
      { status: 500 }
    );
  }
}
