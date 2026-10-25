import { publicImage, readGallery } from "@/lib/gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gallery = await readGallery();
  return Response.json({ images: gallery.map(publicImage) });
}
