import {
  createVariation,
  errorMessage,
  findGalleryImage,
  saveImage,
} from "@/lib/gallery";
import { errorResponse, readJson } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const imageId = typeof body.imageId === "string" ? body.imageId : "";
    const image = await findGalleryImage(imageId);
    if (!image) {
      return Response.json({ error: "Choose an image from this gallery first." }, { status: 404 });
    }

    const count = Number(body.count ?? 2);
    if (!Number.isInteger(count) || count < 1 || count > 4) {
      return Response.json({ error: "Variation count must be between 1 and 4." }, { status: 400 });
    }
    const prompt = `Create a fresh artistic variation of this image. Preserve its core subject and overall mood, while exploring a distinct composition, palette, lighting, or artistic treatment. Source theme: ${image.theme}.`;
    const results = await Promise.all(Array.from({ length: count }, async () => {
      try {
        const result = await createVariation(image, prompt);
        return await saveImage(result, {
          theme: image.theme,
          prompt,
          provider: image.provider,
          groupId: image.groupId,
          variationOf: image.id,
        });
      } catch (error) {
        return { error: errorMessage(error) };
      }
    }));
    const images = results.filter((result) => !("error" in result));
    const errors = results.flatMap((result) => "error" in result
      ? [{ provider: image.provider, error: result.error }]
      : []);

    return Response.json({ images, errors }, { status: images.length ? 200 : 502 });
  } catch (error) {
    return errorResponse(error);
  }
}
