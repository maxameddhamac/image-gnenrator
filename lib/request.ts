import { HttpError } from "@/lib/gallery";

const maxRequestBytes = 1_000_000;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxRequestBytes) {
    throw new HttpError("Request body is too large.", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError("Request body must be valid JSON.", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError("Request body must be a JSON object.", 400);
  }
  return parsed as Record<string, unknown>;
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return Response.json({ error: message }, { status });
}
