import { cookies } from "next/headers";
import { AppError } from "./errors";
import { sessionUser } from "./auth";
import { appUrl } from "./stripe";

export const COOKIE = "tiny_notes_session";
export async function currentUser() {
  return sessionUser((await cookies()).get(COOKIE)?.value);
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new AppError("Please log in.", 401);
  return user;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(appUrl()).origin)
    throw new AppError("Request origin is not allowed.", 403);
}
export async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new AppError("Request is too large.", 413);
  const text = await request.text();
  if (text.length > 4096) throw new AppError("Request is too large.", 413);
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("object required");
    return body as Record<string, unknown>;
  } catch {
    throw new AppError("Invalid JSON object.");
  }
}
export function field(body: Record<string, unknown>, key: string) {
  if (typeof body[key] !== "string") throw new AppError(`Missing ${key}.`);
  return body[key] as string;
}
export async function respond(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : "Something went wrong. Please try again.",
      },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
