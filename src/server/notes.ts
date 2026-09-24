import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { notes, subscriptions } from "./schema";
import { AppError } from "./errors";

export function planFor(userId: string) {
  const subscription = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .get();
  const pro =
    subscription?.status === "active" || subscription?.status === "trialing";
  return {
    name: pro ? "Pro" : "Free",
    limit: pro ? 20 : 3,
    status: subscription?.status ?? "none",
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    hasCustomer: !!subscription,
  };
}
export function listNotes(userId: string) {
  return db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.createdAt))
    .all();
}
export function createNote(userId: string, body: string) {
  body = body.trim();
  if (!body || body.length > 500)
    throw new AppError("Write between 1 and 500 characters.");
  // One immediate transaction prevents concurrent requests bypassing the limit.
  return db.transaction(
    (tx) => {
      const limit = planFor(userId).limit;
      const total = tx
        .select({ value: count() })
        .from(notes)
        .where(eq(notes.userId, userId))
        .get()!.value;
      if (total >= limit)
        throw new AppError(
          `Your plan allows ${limit} notes. Delete a note or upgrade.`,
          409,
        );
      return tx
        .insert(notes)
        .values({ id: randomUUID(), userId, body, createdAt: Date.now() })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
}
export function deleteNote(userId: string, noteId: string) {
  const removed = db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ id: notes.id })
    .get();
  if (!removed) throw new AppError("Note not found.", 404);
}
