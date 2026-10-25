import { randomUUID } from "node:crypto";
import {
  errorMessage,
  generateImage,
  saveImage,
} from "@/lib/gallery";
import { errorResponse, readJson } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const theme = typeof body.theme === "string" ? body.theme.trim() : "";
    if (!theme || theme.length > 180) {
      return Response.json({ error: "Enter a theme of 1 to 180 characters." }, { status: 400 });
    }

    const prompt = `Create a striking, original piece of visual art inspired by: ${theme}. Make it visually rich, beautifully composed, and suitable for a fine-art gallery.`;
    const groupId = randomUUID();
    const provider = "OpenRouter";
    try {
      const result = await generateImage(prompt);
      const image = await saveImage(result, { theme, prompt, provider, groupId });
      return Response.json({ images: [image], errors: [] });
    } catch (error) {
      return Response.json(
        { images: [], errors: [{ provider, error: errorMessage(error) }] },
        { status: 502 },
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
