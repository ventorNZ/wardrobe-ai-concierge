import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WardrobeItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type GenerateBody = {
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

function buildPrompt(input: GenerateBody) {
  const clothingSummary = input.selected
    .map((item) => `- ${item.category}: ${item.name}${item.brand ? `, brand ${item.brand}` : ""}${item.colour ? `, colour ${item.colour}` : ""}${item.size_label ? `, size ${item.size_label}` : ""}`)
    .join("\n");

  return `
Create a realistic full-body outfit preview using the first image as the person's body and face reference.
Use the other images only as clothing references.

Person/body reference:
- Preserve face likeness, body proportions, pose direction, approximate age, skin tone, and realistic fit.
- Do not make the person slimmer, more muscular, younger, or more model-like than the body reference.

Selected outfit pieces:
${clothingSummary}

Context:
- Occasion: ${input.occasion || "not specified"}
- Weather/vibe: ${input.weather || "not specified"}
- Extra notes: ${input.notes || "none"}

Output:
- Photorealistic indoor mirror/bedroom style full-body image.
- The person is wearing the selected outfit pieces together.
- Keep the clothes faithful to the reference images: colours, shape, fabric feel, logos, and general fit.
- Natural lighting. No extra clothing items unless needed for modesty or realism.
`.trim();
}

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as GenerateBody;
    if (!input.body?.image_url) return NextResponse.json({ error: "Missing body reference" }, { status: 400 });
    if (!input.selected?.length) return NextResponse.json({ error: "Select at least one item" }, { status: 400 });

    const references = [
      await urlToFile(input.body.image_url, "body-reference.png"),
      ...(await Promise.all(
        input.selected.map((item, index) => urlToFile(item.image_url, `wardrobe-item-${index + 1}.png`))
      ))
    ];

    const prompt = buildPrompt(input);

    const response = await openai.images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      image: references,
      prompt,
      size: "1024x1536"
    });

    const imageBase64 = response.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("The image model returned no image data.");

    const imageDataUrl = `data:image/png;base64,${imageBase64}`;

    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin.from("outfit_generations").insert({
      owner_id: "demo-user",
      title: input.selected.map((item) => item.name).join(" + ").slice(0, 120),
      occasion: input.occasion || null,
      weather: input.weather || null,
      notes: input.notes || null,
      body_item_id: input.body.id,
      selected_item_ids: input.selected.map((item) => item.id),
      output_base64: imageBase64
    });

    return NextResponse.json({ imageDataUrl });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
