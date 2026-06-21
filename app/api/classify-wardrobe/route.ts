import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wardrobeClassificationJsonSchema } from "@/lib/classificationSchema";
import { cleanArray, safeCategory } from "@/lib/wardrobeTaxonomy";
import type { WardrobeClassification, WardrobeItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");
  return new OpenAI({ apiKey });
}

type RequestBody = {
  itemId: string;
  extraContext?: string;
};

function getOutputText(response: unknown) {
  const r = response as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof r.output_text === "string" && r.output_text.trim()) return r.output_text;

  for (const output of r.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
      if (typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }

  throw new Error("The vision model returned no text output.");
}

function buildPrompt(item: WardrobeItem, extraContext?: string) {
  return `
You are the wardrobe ingestion agent for Wardrobe AI.
Analyze this single uploaded photo and return structured JSON only.

Your job:
1. Decide whether the image is a body reference photo of the person for virtual try-on, or a wardrobe item.
2. If it is a body reference, set category to body_reference and describe pose/lighting in body_reference_notes.
3. If it is clothing/accessory, classify it using the broad category enum only, and put the specific item in subcategory.
4. Infer brand only when visible or strongly suggested by logo/label. Do not hallucinate brands.
5. Infer colour, fabric, season, formality, warmth, style tags and useful wardrobe notes.
6. Be useful for a senior executive personal stylist: classify items for work, online meetings, candidate interviews, client meetings, weekends, travel and Auckland weather.

Broad categories allowed:
- body_reference
- top
- bottom
- shoes
- outerwear
- accessory
- other

Known filename/name from upload: ${item.name || "unknown"}
Extra user context: ${extraContext || "none"}
`.trim();
}

function normaliseClassification(parsed: WardrobeClassification): WardrobeClassification {
  const category = parsed.is_body_reference ? "body_reference" : safeCategory(parsed.category);
  return {
    ...parsed,
    category,
    suggested_name: String(parsed.suggested_name || "Wardrobe item").trim().slice(0, 120),
    subcategory: String(parsed.subcategory || category).trim().slice(0, 80),
    brand: parsed.brand ? String(parsed.brand).trim().slice(0, 80) : null,
    primary_colour: parsed.primary_colour ? String(parsed.primary_colour).trim().slice(0, 80) : null,
    secondary_colour: parsed.secondary_colour ? String(parsed.secondary_colour).trim().slice(0, 80) : null,
    pattern: parsed.pattern ? String(parsed.pattern).trim().slice(0, 80) : null,
    fabric_guess: parsed.fabric_guess ? String(parsed.fabric_guess).trim().slice(0, 120) : null,
    fit_type: parsed.fit_type ? String(parsed.fit_type).trim().slice(0, 80) : null,
    season_tags: cleanArray(parsed.season_tags),
    weather_suitability: cleanArray(parsed.weather_suitability),
    style_tags: cleanArray(parsed.style_tags),
    condition_notes: parsed.condition_notes ? String(parsed.condition_notes).trim().slice(0, 250) : null,
    body_reference_notes: parsed.body_reference_notes ? String(parsed.body_reference_notes).trim().slice(0, 300) : null,
    assistant_summary: String(parsed.assistant_summary || "").trim().slice(0, 400),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0)))
  };
}

export async function POST(request: NextRequest) {
  let itemId = "";

  try {
    const body = (await request.json()) as RequestBody;
    itemId = body.itemId;
    if (!itemId) return NextResponse.json({ error: "Missing itemId" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin
      .from("wardrobe_items")
      .update({ classification_status: "classifying", classification_error: null })
      .eq("id", itemId);

    const { data, error } = await supabaseAdmin
      .from("wardrobe_items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (error) throw error;
    if (!data?.image_url) throw new Error("Item has no image URL.");

    const item = data as WardrobeItem;

    const response = await getOpenAI().responses.create({
      model: process.env.OPENAI_VISION_MODEL || "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPrompt(item, body.extraContext) },
            { type: "input_image", image_url: item.image_url, detail: "high" }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "wardrobe_classification",
          schema: wardrobeClassificationJsonSchema,
          strict: true
        }
      }
    } as never);

    const raw = getOutputText(response);
    const parsed = normaliseClassification(JSON.parse(raw) as WardrobeClassification);

    const mergedTags = Array.from(new Set([...(parsed.style_tags ?? []), ...(parsed.season_tags ?? [])]));

    const updatePayload = {
      name: parsed.suggested_name,
      category: parsed.category,
      subcategory: parsed.subcategory,
      brand: parsed.brand,
      colour: parsed.primary_colour,
      colour_primary: parsed.primary_colour,
      colour_secondary: parsed.secondary_colour,
      pattern: parsed.pattern,
      fabric_guess: parsed.fabric_guess,
      fit_type: parsed.fit_type,
      season: parsed.season_tags[0] ?? null,
      season_tags: parsed.season_tags,
      formality: parsed.formality,
      formality_score: parsed.formality_score,
      warmth_score: parsed.warmth_score,
      weather_suitability: parsed.weather_suitability,
      style_tags: parsed.style_tags,
      tags: mergedTags,
      condition_notes: parsed.condition_notes ?? parsed.body_reference_notes,
      ai_summary: parsed.assistant_summary,
      ai_confidence: parsed.confidence,
      classification_status: "classified",
      classification_error: null
    };

    const updated = await supabaseAdmin
      .from("wardrobe_items")
      .update(updatePayload)
      .eq("id", itemId)
      .select("*")
      .single();

    if (updated.error) throw updated.error;

    return NextResponse.json({ item: updated.data, classification: parsed });
  } catch (error) {
    console.error(error);
    if (itemId) {
      try {
        const supabaseAdmin = getSupabaseAdmin();
        await supabaseAdmin
        .from("wardrobe_items")
        .update({
          classification_status: "failed",
          classification_error: error instanceof Error ? error.message : "Classification failed"
        })
        .eq("id", itemId);
      } catch {
        // Ignore secondary failure while reporting the original classification error.
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Classification failed" },
      { status: 500 }
    );
  }
}
