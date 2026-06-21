import sharp from "sharp";
import { toFile } from "openai/uploads";

const MAX_IMAGE_EDGE = 1536;
const MAX_BYTES = 45 * 1024 * 1024;

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

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

async function fetchImageBuffer(imageUrl: string) {
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new Error("Missing image URL");
  }

  const trimmed = imageUrl.trim();
  const dataBuffer = parseDataUrl(trimmed);
  if (dataBuffer) return dataBuffer;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid image URL stored for this wardrobe photo");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported image URL protocol: ${url.protocol}`);
  }

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "wardrobe-ai-concierge/1.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Could not fetch image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Image URL returned ${contentType}, not an image`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Image URL returned an empty file");
  if (buffer.length > MAX_BYTES) throw new Error("Image is too large for generation; upload a smaller photo");

  return buffer;
}

export async function normaliseImageUrl(
  imageUrl: string,
  filename = "wardrobe-reference.png",
): Promise<NormalisedImage> {
  const originalBuffer = await fetchImageBuffer(imageUrl);

  const pngBuffer = await sharp(originalBuffer, { failOn: "none", animated: false })
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9, force: true })
    .toBuffer();

  if (!pngBuffer.length) throw new Error("Image normalisation produced an empty PNG");
  if (pngBuffer.length > MAX_BYTES) throw new Error("Normalised PNG is too large for generation");

  return {
    buffer: pngBuffer,
    mimeType: "image/png",
    filename: safeFilename(filename),
  };
}

export async function imageUrlToOpenAIFile(
  imageUrl: string,
  filename = "wardrobe-reference.png",
) {
  const image = await normaliseImageUrl(imageUrl, filename);
  return toFile(image.buffer, image.filename, { type: image.mimeType });
}

export async function imageUrlToBase64PngDataUrl(
  imageUrl: string,
  filename = "wardrobe-reference.png",
) {
  const image = await normaliseImageUrl(imageUrl, filename);
  return `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
}
