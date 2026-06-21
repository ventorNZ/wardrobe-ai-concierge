import sharp from "sharp";
import { toFile } from "openai/uploads";

const MAX_IMAGE_EDGE = 1536;

type NormalisedImage = {
  buffer: Buffer;
  mimeType: "image/png";
  filename: string;
};

function safeFilename(filename: string) {
  const clean = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 80);
  return clean.endsWith(".png") ? clean : `${clean || "wardrobe-reference"}.png`;
}

async function fetchImageBuffer(imageUrl: string) {
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new Error("Missing image URL");
  }

  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "wardrobe-ai-concierge/1.0" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Could not fetch image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Image URL returned ${contentType || "unknown content type"}, not an image`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Image URL returned an empty file");
  return buffer;
}

export async function normaliseImageUrl(imageUrl: string, filename = "wardrobe-reference.png"): Promise<NormalisedImage> {
  const originalBuffer = await fetchImageBuffer(imageUrl);

  const pngBuffer = await sharp(originalBuffer, {
    failOn: "none",
    animated: false
  })
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true
    })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (!pngBuffer.length) throw new Error("Image normalisation produced an empty PNG");

  return {
    buffer: pngBuffer,
    mimeType: "image/png",
    filename: safeFilename(filename)
  };
}

export async function imageUrlToOpenAIFile(imageUrl: string, filename = "wardrobe-reference.png") {
  const image = await normaliseImageUrl(imageUrl, filename);
  return toFile(image.buffer, image.filename, { type: image.mimeType });
}

export async function imageUrlToBase64PngDataUrl(imageUrl: string, filename = "wardrobe-reference.png") {
  const image = await normaliseImageUrl(imageUrl, filename);
  return `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
}
