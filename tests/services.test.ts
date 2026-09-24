import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

const folder = mkdtempSync(join(tmpdir(), "tiny-notes-test-"));
process.env.DATABASE_PATH = join(folder, "test.sqlite");
process.env.STRIPE_SECRET_KEY = "sk_test_offline_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_offline_only";
process.env.STRIPE_PRICE_ID = "price_pro";
const { db, sqlite } = await import("../src/server/db");
const { users, sessions, subscriptions, stripeEvents } =
  await import("../src/server/schema");
const { signUp, logIn, logOut, sessionUser } =
  await import("../src/server/auth");
const { createNote, listNotes, deleteNote, planFor } =
  await import("../src/server/notes");
const { applyStripeEvent, startCheckout, openPortal } =
  await import("../src/server/billing");
const { verifyStripeEvent, stripeClient } =
  await import("../src/server/stripe");
sqlite.exec(readFileSync("migrations/0001.sql", "utf8"));
after(() => {
  sqlite.close();
  rmSync(folder, { recursive: true, force: true });
});

// All provider responses here are explicit test doubles. No network calls.
let current: Stripe.Subscription[] = [];
let checkouts = 0;
let checkoutArgs: unknown;
const fake = {
  customers: { create: async () => ({ id: "cus_alice" }) },
  subscriptions: { list: async () => ({ data: current, has_more: false }) },
  checkout: {
    sessions: {
      create: async (args: unknown) => {
        checkouts++;
        checkoutArgs = args;
        return {
          id: "cs_one",
          url: "https://checkout.stripe.com/test",
          status: "open",
        };
      },
      retrieve: async () => ({
        id: "cs_one",
        url: "https://checkout.stripe.com/test",
        status: "open",
      }),
    },
  },
  billingPortal: {
    sessions: {
      create: async () => ({ url: "https://billing.stripe.com/test" }),
    },
  },
} as unknown as Stripe;
function subscription(status: Stripe.Subscription.Status, price = "price_pro") {
  return {
    id: "sub_one",
    customer: "cus_alice",
    status,
    created: 1,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: price } }] },
  } as unknown as Stripe.Subscription;
}
function event(
  id: string,
  status: Stripe.Subscription.Status,
  type = "customer.subscription.updated",
) {
  return {
    id,
    type,
    livemode: false,
    data: { object: subscription(status) },
  } as Stripe.Event;
}
let alice: { id: string; email: string };
let token: string;
test("sign up, normalize email, hash credentials, reject duplicates and wrong password", async () => {
  token = await signUp(" Alice@example.com ", "a-long-test-password");
  alice = sessionUser(token)!;
  assert.equal(alice.email, "alice@example.com");
  assert.notEqual(
    db.select().from(users).get()!.passwordHash,
    "a-long-test-password",
  );
  assert.notEqual(db.select().from(sessions).get()!.tokenHash, token);
  await assert.rejects(
    signUp("alice@example.com", "a-long-test-password"),
    /already registered/,
  );
  await assert.rejects(
    logIn("alice@example.com", "incorrect-password"),
    /incorrect/,
  );
  await assert.rejects(signUp("x@example.com", "short"), /12 and 128/);
});
test("free quota is server enforced; another user's notes cannot be read or deleted", async () => {
  const other = sessionUser(
    await signUp("bob@example.com", "another-long-password"),
  )!;
  const first = createNote(alice.id, "First");
  createNote(alice.id, "Second");
  createNote(alice.id, "Third");
  assert.throws(() => createNote(alice.id, "Fourth"), /allows 3/);
  assert.equal(listNotes(other.id).length, 0);
  assert.throws(() => deleteNote(other.id, first.id), /not found/);
  assert.equal(listNotes(alice.id).length, 3);
  deleteNote(alice.id, first.id);
  createNote(alice.id, "Replacement");
  assert.throws(() => createNote(alice.id, " "), /1 and 500/);
});
test("checkout reuses an open session, server chooses the price, and checkout alone grants no Pro", async () => {
  assert.match(await startCheckout(alice, fake), /checkout.stripe.com/);
  await startCheckout(alice, fake);
  assert.equal(checkouts, 1);
  assert.deepEqual((checkoutArgs as { line_items: unknown }).line_items, [
    { price: "price_pro", quantity: 1 },
  ]);
  assert.equal(planFor(alice.id).name, "Free");
  assert.match(await openPortal(alice.id, fake), /billing.stripe.com/);
});
test("verified current subscription grants Pro; duplicate events are idempotent", async () => {
  current = [subscription("active")];
  const incoming = event("evt_active", "active");
  await applyStripeEvent(incoming, fake);
  await applyStripeEvent(incoming, fake);
  assert.equal(planFor(alice.id).limit, 20);
  assert.equal(db.select().from(stripeEvents).all().length, 1);
  createNote(alice.id, "A fourth note on Pro");
  await assert.rejects(
    startCheckout(alice, fake),
    /already have a subscription/,
  );
});
test("past due and cancelled remove entitlement but retain notes; stale event cannot restore it", async () => {
  current = [subscription("past_due")];
  await applyStripeEvent(event("evt_due", "past_due"), fake);
  assert.equal(planFor(alice.id).name, "Free");
  current = [subscription("canceled")];
  await applyStripeEvent(
    event("evt_cancel", "canceled", "customer.subscription.deleted"),
    fake,
  );
  await applyStripeEvent(event("evt_old_active", "active"), fake);
  assert.equal(planFor(alice.id).name, "Free");
  assert.equal(listNotes(alice.id).length, 4);
  assert.throws(() => createNote(alice.id, "Too many"), /allows 3/);
});
test("unrelated price cannot grant Pro; scheduled cancellation retains active access", async () => {
  current = [subscription("active", "price_something_else")];
  await applyStripeEvent(event("evt_other_price", "active"), fake);
  assert.equal(planFor(alice.id).name, "Free");
  current = [{ ...subscription("active"), cancel_at_period_end: true }];
  await applyStripeEvent(event("evt_scheduled", "active"), fake);
  assert.equal(planFor(alice.id).name, "Pro");
  assert.equal(planFor(alice.id).cancelAtPeriodEnd, true);
});
test("Stripe SDK verifies raw signed bodies and rejects tampering and live keys", () => {
  const raw = JSON.stringify(event("evt_signed", "active"));
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  assert.equal(verifyStripeEvent(raw, signature).id, "evt_signed");
  assert.throws(
    () => verifyStripeEvent(raw + " ", signature),
    /Invalid Stripe/,
  );
  assert.throws(() => verifyStripeEvent(raw, "invalid"), /Invalid Stripe/);
  process.env.STRIPE_SECRET_KEY = "sk_live_not_allowed";
  assert.throws(stripeClient, /test secret key/);
  process.env.STRIPE_SECRET_KEY = "sk_test_offline_only";
});
test("logout invalidates the session; expiry rejects old sessions", async () => {
  logOut(token);
  assert.equal(sessionUser(token), null);
  const fresh = await logIn("alice@example.com", "a-long-test-password");
  assert.equal(sessionUser(fresh)!.id, alice.id);
  db.update(sessions)
    .set({ expiresAt: 0 })
    .where(eq(sessions.userId, alice.id))
    .run();
  assert.equal(sessionUser(fresh), null);
});
