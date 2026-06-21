import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WardrobeItem, WardrobeItemPhoto } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");
  return new OpenAI({ apiKey });
}

type GenerateBody = {
  profileId?: string;
  sessionId?: string;
  lookLabel?: string;
  body: WardrobeItem;
  selected: WardrobeItem[];
  occasion?: string;
  weather?: string;
  notes?: string;
};

async function urlToFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${filename}`);
  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return toFile(buffer, filename, { type: contentType });
}

function compactName(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "item";
}

async function getReferenceUrls(selected: WardrobeItem[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const selectedIds = selected.map((item) => item.id);
  const fallback = new Map(selected.map((item) => [item.id, [item.image_url].filter(Boolean)]));

  if (selectedIds.length === 0) return fallback;

  const { data, error } = await supabaseAdmin
    .from("wardrobe_item_photos")
    .select("*")
    .in("wardrobe_item_id", selectedIds)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return fallback;

  const grouped = new Map<string, string[]>();
  for (const photo of (data ?? []) as WardrobeItemPhoto[]) {
    if (!photo.wardrobe_item_id || !photo.image_url) continue;
    const current = grouped.get(photo.wardrobe_item_id) ?? [];
    if (!current.includes(photo.image_url) && current.length < 2) current.push(photo.image_url);
    grouped.set(photo.wardrobe_item_id, current);
  }

  for (const item of selected) {
    const urls = grouped.get(item.id) ?? [];
    if (item.image_url && !urls.includes(item.image_url) && urls.length < 2) urls.push(item.image_url);
    if (!urls.length && item.image_url) urls.push(item.image_url);
    grouped.set(item.id, urls);
  }

  return grouped;
}

function buildPrompt(input: GenerateBody) {
  const clothingSummary = input.selected
    .map((item) => `- ${item.category}: ${item.name}${item.brand ? `, brand ${item.brand}` : ""}${item.colour_primary || item.colour ? `, colour ${item.colour_primary || item.colour}` : ""}${item.size_label ? `, size ${item.size_label}` : ""}${item.angle_count && item.angle_count > 1 ? `, ${item.angle_count} photo angles available` : ""}`)
    .join("\n");

  return `
Create ONE realistic full-body outfit preview for ${input.lookLabel ? `Look ${input.lookLabel}` : "this outfit"}.
Use the first image as the person's body and face reference.
Use all other images only as clothing references. Some clothing items may have multiple angles; combine those angles into one accurate item, not multiple duplicate garments.

Person/body reference:
- Preserve face likeness, body proportions, pose direction, approximate age, skin tone, and realistic fit.
- Do not make the person slimmer, more muscular, younger, taller, or more model-like than the body reference.
- Keep the body realistic and respectful. This is a clothing try-on, not a body transformation.

Selected outfit pieces:
${clothingSummary}

Context:
- Occasion: ${input.occasion || "not specified"}
- Weather/vibe: ${input.weather || "not specified"}
- Extra notes: ${input.notes || "none"}

Output:
- Photorealistic indoor full-body image.
- The person is wearing the selected outfit pieces together.
- Keep clothes faithful to the reference images: colours, shape, fabric feel, logos, and general fit.
- Do not add unrelated items. No outfit swapping from other looks.
- Natural lighting.
`.trim();
}

export async function POST(request: NextRequest) {
  let previewId = "";

  try {
    const input = (await request.json()) as GenerateBody;
    if (!input.body?.image_url) return NextResponse.json({ error: "Missing body reference" }, { status: 400 });
    if (!input.selected?.length) return NextResponse.json({ error: "Select at least one item" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    const selectedIds = input.selected.map((item) => item.id);
    const prompt = buildPrompt(input);

    if (input.profileId && input.sessionId && input.lookLabel) {
      const queued = await supabaseAdmin
        .from("outfit_previews")
        .insert({
          owner_id: "demo-user",
          profile_id: input.profileId,
          stylist_session_id: input.sessionId,
          look_label: input.lookLabel,
          outfit_item_ids: selectedIds,
          body_item_id: input.body.id,
          prompt,
          status: "generating"
        })
        .select("id")
        .single();

      if (!queued.error && queued.data?.id) previewId = queued.data.id;
    }

    const referenceUrls = await getReferenceUrls(input.selected);
    const clothingFiles: Awaited<ReturnType<typeof toFile>>[] = [];

    for (const [itemId, urls] of referenceUrls.entries()) {
      const item = input.selected.find((entry) => entry.id === itemId);
      for (let index = 0; index < urls.length; index += 1) {
        clothingFiles.push(await urlToFile(urls[index], `${compactName(item?.name || "wardrobe-item")}-${index + 1}.png`));
      }
    }

    const references = [
      await urlToFile(input.body.image_url, "body-reference.png"),
      ...clothingFiles.slice(0, 12)
    ];

    const response = await getOpenAI().images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      image: references,
      prompt,
      size: "1024x1536"
    });

    const imageBase64 = response.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("The image model returned no image data.");

    const imageDataUrl = `data:image/png;base64,${imageBase64}`;

    await supabaseAdmin.from("outfit_generations").insert({
      owner_id: "demo-user",
      title: input.selected.map((item) => item.name).join(" + ").slice(0, 120),
      occasion: input.occasion || null,
      weather: input.weather || null,
      notes: input.notes || null,
      stylist_brief: prompt,
      body_item_id: input.body.id,
      selected_item_ids: selectedIds,
      output_base64: imageBase64
    });

    if (previewId) {
      await supabaseAdmin
        .from("outfit_previews")
        .update({ status: "complete", output_base64: imageBase64, updated_at: new Date().toISOString() })
        .eq("id", previewId);
    }

    return NextResponse.json({ imageDataUrl, previewId });
  } catch (error) {
    console.error(error);
    if (previewId) {
      try {
        const supabaseAdmin = getSupabaseAdmin();
        await supabaseAdmin
          .from("outfit_previews")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Generation failed",
            updated_at: new Date().toISOString()
          })
          .eq("id", previewId);
      } catch {
        // Ignore secondary failure while reporting original generation error.
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
