import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { users, sessions } from "./schema";
import { AppError } from "./errors";

const scrypt = promisify(scryptCallback);
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function credentials(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new AppError("Enter a valid email address.");
  if (password.length < 12 || password.length > 128)
    throw new AppError("Use a password between 12 and 128 characters.");
  return normalized;
}
export async function signUp(email: string, password: string) {
  email = credentials(email, password);
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const id = randomUUID();
  const inserted = db
    .insert(users)
    .values({ id, email, passwordHash: `${salt}:${hash.toString("hex")}` })
    .onConflictDoNothing()
    .returning({ id: users.id })
    .get();
  if (!inserted)
    throw new AppError(
      "This email is already registered. Log in instead.",
      409,
    );
  return issueSession(id);
}
export async function logIn(email: string, password: string) {
  email = credentials(email, password);
  const user = db.select().from(users).where(eq(users.email, email)).get();
  // Do the same expensive operation for an unknown account.
  const [salt, stored] = user?.passwordHash.split(":") ?? [
    "0".repeat(32),
    "0".repeat(128),
  ];
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  if (!user || !timingSafeEqual(hash, Buffer.from(stored, "hex")))
    throw new AppError("Email or password is incorrect.", 401);
  return issueSession(user.id);
}
function issueSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db.insert(sessions)
    .values({
      tokenHash: digest(token),
      userId,
      expiresAt: Date.now() + SESSION_SECONDS * 1000,
    })
    .run();
  return token;
}
export function sessionUser(token: string | undefined) {
  if (!token) return null;
  return (
    db
      .select({ id: users.id, email: users.email })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, digest(token)),
          gt(sessions.expiresAt, Date.now()),
        ),
      )
      .get() ?? null
  );
}
export function logOut(token: string) {
  db.delete(sessions)
    .where(eq(sessions.tokenHash, digest(token)))
    .run();
}
