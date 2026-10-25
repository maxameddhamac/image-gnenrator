import { findGalleryImage, getImageBytes } from "@/lib/gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "Image not found." }, { status: 404 });
  }
  const image = await findGalleryImage(id);
  if (!image) return Response.json({ error: "Image not found." }, { status: 404 });

  try {
    const bytes = await getImageBytes(image.filename);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "Image file is missing from gallery storage." }, { status: 404 });
  }
}
