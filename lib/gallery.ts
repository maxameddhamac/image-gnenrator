import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const providers = ["OpenRouter"] as const;

export type Provider = (typeof providers)[number];

export interface GalleryImage {
  id: string;
  filename: string;
  theme: string;
  prompt: string;
  provider: Provider;
  groupId: string;
  createdAt: string;
  width: number;
  height: number;
  qualityScore: number;
  quality: {
    sharpness: number;
    detail: number;
    resolution: string;
  };
  sourceUrl: string | null;
  variationOf: string | null;
}

export type PublicImage = Omit<GalleryImage, "sourceUrl"> & { url: string };

export interface ImageResult {
  bytes: Buffer;
  sourceUrl: string | null;
}

const galleryDirectory = path.join(process.cwd(), "gallery");
const indexPath = path.join(galleryDirectory, "index.json");
const maxImageBytes = 20 * 1024 * 1024;
const defaultImageModel = "openai/gpt-image-2.5-sunburst";
let galleryWrite = Promise.resolve();

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export function publicImage(image: GalleryImage): PublicImage {
  const { sourceUrl: _sourceUrl, ...details } = image;
  return { ...details, url: `/api/images/${image.id}` };
}

export async function readGallery(): Promise<GalleryImage[]> {
  try {
    const value: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (!Array.isArray(value)) throw new Error("Gallery index must be an array.");
    return value as GalleryImage[];
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function findGalleryImage(id: string): Promise<GalleryImage | undefined> {
  return (await readGallery()).find((image) => image.id === id);
}

export async function getImageBytes(filename: string): Promise<Buffer> {
  return readFile(path.join(galleryDirectory, filename));
}

async function providerRequest(
  url: string,
  options: RequestInit,
  provider: Provider,
): Promise<Response> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed)) {
        const providerError = isRecord(parsed.error) ? getString(parsed.error.message) : undefined;
        message = providerError
          ?? getString(parsed.detail)
          ?? getString(parsed.message)
          ?? body;
      }
    } catch {
      // Retain plain-text provider errors.
    }
    throw new Error(`${provider} returned ${response.status}: ${message.slice(0, 400)}`);
  }
  return response;
}

async function fetchImage(url: string, provider: Provider): Promise<ImageResult> {
  const response = await providerRequest(url, {}, provider);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`${provider} did not return an image.`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxImageBytes) throw new Error(`${provider} image exceeds the 20 MB limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxImageBytes) throw new Error(`${provider} image exceeds the 20 MB limit.`);
  return { bytes, sourceUrl: url };
}

async function imageFromOpenRouterResponse(response: Response): Promise<ImageResult> {
  const payload: unknown = await response.json();
  const image = isRecord(payload) && Array.isArray(payload.data) ? payload.data[0] : undefined;
  if (!isRecord(image)) throw new Error("OpenRouter response did not contain an image.");
  const base64 = getString(image.b64_json);
  if (base64) {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length > maxImageBytes) throw new Error("OpenRouter image exceeds the 20 MB limit.");
    return { bytes, sourceUrl: null };
  }
  const url = getString(image.url);
  if (url) return fetchImage(url, "OpenRouter");
  throw new Error("OpenRouter response did not contain an image.");
}

async function generateOpenRouterImage(prompt: string, reference?: Buffer): Promise<ImageResult> {
  const configuredModel = process.env.OPENROUTER_IMAGE_MODEL?.trim();
  const model = !configuredModel
    || configuredModel === "gpt-image-1"
    || configuredModel === "openai/gpt-image-1"
    ? defaultImageModel
    : configuredModel;
  const inputReferences = reference
    ? [{
      type: "image_url",
      image_url: { url: `data:image/png;base64,${reference.toString("base64")}` },
    }]
    : undefined;
  const response = await providerRequest(
    "https://openrouter.ai/api/v1/images",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        ...(inputReferences ? { input_references: inputReferences } : {}),
      }),
    },
    "OpenRouter",
  );
  return imageFromOpenRouterResponse(response);
}

export async function generateImage(prompt: string): Promise<ImageResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  return generateOpenRouterImage(prompt);
}

export async function createVariation(image: GalleryImage, prompt: string): Promise<ImageResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  const imageBytes = await getImageBytes(image.filename);
  return generateOpenRouterImage(prompt, imageBytes);
}

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 50) || "artwork";
}

export async function saveImage(
  result: ImageResult,
  details: {
    theme: string;
    prompt: string;
    provider: Provider;
    groupId: string;
    variationOf?: string;
  },
): Promise<PublicImage> {
  const png = await sharp(result.bytes).png().toBuffer();
  const metadata = await sharp(png).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Generated image has invalid dimensions.");

  const { data: sample, info: sampleInfo } = await sharp(png)
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let laplacian = 0;
  let laplacianSquared = 0;
  let samples = 0;
  for (let y = 1; y < sampleInfo.height - 1; y += 1) {
    for (let x = 1; x < sampleInfo.width - 1; x += 1) {
      const position = y * sampleInfo.width + x;
      const value = 4 * sample[position] - sample[position - 1] - sample[position + 1]
        - sample[position - sampleInfo.width] - sample[position + sampleInfo.width];
      laplacian += value;
      laplacianSquared += value * value;
      samples += 1;
    }
  }

  const sharpness = samples
    ? Math.max(0, laplacianSquared / samples - (laplacian / samples) ** 2)
    : 0;
  const stats = await sharp(png).stats();
  const sharpnessScore = Math.min(100, Math.log10(1 + sharpness) * 20);
  const detailScore = Math.min(100, stats.entropy * 25);
  const resolutionScore = Math.min(100, (metadata.width * metadata.height / (1024 * 1024)) * 100);
  const qualityScore = Math.round(sharpnessScore * 0.45 + detailScore * 0.25 + resolutionScore * 0.3);
  const id = randomUUID();
  const filename = `${slugify(details.theme)}-${id.slice(0, 8)}.png`;
  await mkdir(galleryDirectory, { recursive: true });
  await writeFile(path.join(galleryDirectory, filename), png);

  const image: GalleryImage = {
    id,
    filename,
    theme: details.theme,
    prompt: details.prompt,
    provider: details.provider,
    groupId: details.groupId,
    createdAt: new Date().toISOString(),
    width: metadata.width,
    height: metadata.height,
    qualityScore,
    quality: {
      sharpness: Math.round(sharpness),
      detail: Number(stats.entropy.toFixed(2)),
      resolution: `${metadata.width}x${metadata.height}`,
    },
    sourceUrl: result.sourceUrl,
    variationOf: details.variationOf ?? null,
  };

  const persist = galleryWrite.then(async () => {
    const updated = [image, ...(await readGallery())];
    const temporaryIndex = `${indexPath}.${id}.tmp`;
    await writeFile(temporaryIndex, JSON.stringify(updated, null, 2));
    await rename(temporaryIndex, indexPath);
  });
  galleryWrite = persist.then(() => undefined, () => undefined);
  await persist;

  return publicImage(image);
}

export function errorMessage(error: unknown): string {
  return getErrorMessage(error);
}
