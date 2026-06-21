import { NextRequest, NextResponse } from "next/server";
import { generateOutfitPreview, type GenerateInput } from "@/lib/serverGenerate";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as GenerateInput;
    if (!input.body?.image_url) return NextResponse.json({ error: "Missing body reference" }, { status: 400 });
    if (!input.selected?.length) return NextResponse.json({ error: "Select at least one item" }, { status: 400 });

    const result = await generateOutfitPreview(input);
    return NextResponse.json({
      ok: true,
      imageDataUrl: result.imageDataUrl,
      previewId: result.previewId,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error("/api/generate-outfit failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Generation failed",
      },
      { status: 500 },
    );
  }
}
