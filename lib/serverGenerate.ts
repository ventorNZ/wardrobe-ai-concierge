import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { imageUrlToOpenAIFile } from "@/lib/openaiImage";
import type { WardrobeItem, WardrobeItemPhoto } from "@/lib/types";

export type GenerateInput = {
  profileId?: string;
  sessionId?: string;
  lookLabel?: string;
  body: WardrobeItem;
  selected: WardrobeItem[];
  occasion?: string;
  weather?: string;
  notes?: string;
};

const MAX_REFERENCE_IMAGES = 8;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");
  return new OpenAI({ apiKey });
}

function compactName(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "item";
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Generation failed";
  if (message.includes("did not match the expected pattern")) {
    return "The image request was rejected before OpenAI could generate it. This hotfix now forces clean PNG references and a safe square image size; retry the look.";
  }
  return message;
}

async function getReferenceUrls(selected: WardrobeItem[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const selectedIds = selected.map((item) => item.id).filter(Boolean);
  const fallback = new Map<string, string[]>();
  for (const item of selected) {
    if (item.image_url) fallback.set(item.id, [item.image_url]);
  }
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
    if (!current.includes(photo.image_url) && current.length < 1) current.push(photo.image_url);
    grouped.set(photo.wardrobe_item_id, current);
  }

  for (const item of selected) {
    const urls = grouped.get(item.id) ?? [];
    if (item.image_url && !urls.includes(item.image_url) && urls.length < 1) urls.push(item.image_url);
    if (urls.length) grouped.set(item.id, urls);
  }

  return grouped;
}

function buildPrompt(input: GenerateInput) {
  const clothingSummary = input.selected
    .map((item) => `- ${item.category}: ${item.name}${item.brand ? `, brand ${item.brand}` : ""}${item.colour_primary || item.colour ? `, colour ${item.colour_primary || item.colour}` : ""}${item.size_label ? `, size ${item.size_label}` : ""}${item.pattern ? `, pattern ${item.pattern}` : ""}`)
    .join("\n");

  return `Create one realistic, respectful outfit try-on image for ${input.lookLabel ? `Look ${input.lookLabel}` : "this selected outfit"}.

Reference order:
1. First image = person/body/face reference.
2. Remaining images = clothing references only.

Preserve the person's face likeness, body proportions, height impression, pose direction, skin tone and realistic fit. Do not make the person slimmer, younger, taller, more muscular or more model-like. This is a clothing try-on only.

Selected outfit pieces:
${clothingSummary}

Context:
- Occasion: ${input.occasion || "today"}
- Weather/vibe: ${input.weather || "not specified"}
- Notes: ${input.notes || "Use only the selected wardrobe pieces."}

Output requirements:
- Photorealistic full-body image.
- Natural indoor lighting.
- Clothes must stay faithful to the uploaded references: colour, shape, fabric, logos, length and general fit.
- Do not add unrelated garments or accessories.
- Do not create a text background, labels, UI, captions or explanation in the image.`;
}

async function buildImageReferences(input: GenerateInput) {
  const references: Awaited<ReturnType<typeof imageUrlToOpenAIFile>>[] = [];
  const skipped: string[] = [];

  try {
    references.push(await imageUrlToOpenAIFile(input.body.image_url, "body-reference.png"));
  } catch (error) {
    throw new Error(`Body reference image could not be prepared. ${publicError(error)}`);
  }

  const referenceUrls = await getReferenceUrls(input.selected);
  for (const [itemId, urls] of referenceUrls.entries()) {
    const item = input.selected.find((entry) => entry.id === itemId);
    for (let index = 0; index < urls.length; index += 1) {
      if (references.length >= MAX_REFERENCE_IMAGES) break;
      try {
        references.push(await imageUrlToOpenAIFile(urls[index], `${compactName(item?.name || "wardrobe-item")}-${index + 1}.png`));
      } catch (error) {
        skipped.push(`${item?.name || itemId}: ${publicError(error)}`);
      }
    }
  }

  if (references.length < 2) {
    throw new Error(`No usable wardrobe item reference images could be prepared.${skipped.length ? ` Skipped: ${skipped.join(" | ")}` : ""}`);
  }

  return { references, skipped };
}

export async function generateOutfitPreview(input: GenerateInput) {
  if (!input.body?.image_url) throw new Error("Missing body reference");
  if (!input.selected?.length) throw new Error("Select at least one item");

  const supabaseAdmin = getSupabaseAdmin();
  const selectedIds = input.selected.map((item) => item.id).filter(Boolean);
  const prompt = buildPrompt(input);
  let previewId = "";

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
        status: "generating",
      })
      .select("id")
      .single();
    if (!queued.error && queued.data?.id) previewId = queued.data.id as string;
  }

  try {
    const { references, skipped } = await buildImageReferences(input);
    const requestedSize = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
    const imageSize = ["1024x1024", "1024x1536", "1536x1024"].includes(requestedSize)
      ? requestedSize
      : "1024x1024";
    const response = await getOpenAI().images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      image: references as never,
      prompt,
      size: imageSize,
    } as never);

    const imageBase64 = response.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("The image model returned no image data.");

    const imageDataUrl = `data:image/png;base64,${imageBase64}`;

    try {
      await supabaseAdmin.from("outfit_generations").insert({
        owner_id: "demo-user",
        title: input.selected.map((item) => item.name).join(" + ").slice(0, 120),
        occasion: input.occasion || null,
        weather: input.weather || null,
        notes: skipped.length ? `${input.notes || ""}\nSkipped invalid image references: ${skipped.join(" | ")}`.trim() : input.notes || null,
        stylist_brief: prompt,
        body_item_id: input.body.id,
        selected_item_ids: selectedIds,
        output_base64: imageBase64,
      });
    } catch (dbError) {
      console.warn("Could not save outfit generation history", dbError);
    }

    if (previewId) {
      await supabaseAdmin
        .from("outfit_previews")
        .update({
          status: "complete",
          output_base64: imageBase64,
          error_message: skipped.length ? `Skipped invalid image references: ${skipped.join(" | ")}` : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", previewId);
    }

    return { imageDataUrl, imageBase64, previewId, skipped };
  } catch (error) {
    if (previewId) {
      await supabaseAdmin
        .from("outfit_previews")
        .update({
          status: "failed",
          error_message: publicError(error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", previewId);
    }
    throw new Error(publicError(error));
  }
}
