import { cookies } from "next/headers";
import {
  logIn,
  logOut,
  signUp,
  SESSION_SECONDS,
} from "../../../../server/auth";
import { AppError } from "../../../../server/errors";
import {
  COOKIE,
  field,
  jsonBody,
  respond,
  sameOrigin,
} from "../../../../server/http";
import { appUrl } from "../../../../server/stripe";

// A small in-memory throttle is sufficient for this localhost, single-process sample.
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return respond(async () => {
    sameOrigin(request);
    const { action } = await context.params;
    const jar = await cookies();
    if (action === "logout") {
      const token = jar.get(COOKIE)?.value;
      if (token) logOut(token);
      jar.delete(COOKIE);
      return { ok: true };
    }
    if (action !== "login" && action !== "signup")
      throw new AppError("Not found.", 404);
    const body = await jsonBody(request);
    const email = field(body, "email");
    const key = email.trim().toLowerCase();
    const now = Date.now();
    for (const [k, value] of attempts)
      if (value.until <= now) attempts.delete(k);
    const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
    if (++entry.count > 10 || attempts.size > 1000)
      throw new AppError("Too many attempts. Try again in a minute.", 429);
    attempts.set(key, entry);
    const token = await (action === "signup" ? signUp : logIn)(
      email,
      field(body, "password"),
    );
    jar.set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(appUrl()).protocol === "https:",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    return { ok: true };
  });
}
