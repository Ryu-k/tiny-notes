import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { subscriptions, stripeEvents } from "./schema";
import { AppError } from "./errors";
import { appUrl, priceId, stripeClient } from "./stripe";

type Account = { id: string; email: string };
const rowFor = (userId: string) =>
  db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
export async function startCheckout(user: Account, stripe = stripeClient()) {
  const price = priceId();
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    throw new AppError(
      "Configure the Stripe webhook before starting checkout.",
      503,
    );
  let row = rowFor(user.id);
  if (!row) {
    const customer = await stripe.customers.create(
      { email: user.email },
      { idempotencyKey: `tiny-notes-customer-${user.id}` },
    );
    db.insert(subscriptions)
      .values({
        userId: user.id,
        customerId: customer.id,
        checkoutKey: randomUUID(),
      })
      .onConflictDoNothing()
      .run();
    row = rowFor(user.id)!;
  }
  const existing = await stripe.subscriptions.list({
    customer: row.customerId,
    status: "all",
    limit: 100,
  });
  if (
    existing.has_more ||
    existing.data.some(
      (s) => s.status !== "canceled" && s.status !== "incomplete_expired",
    )
  )
    throw new AppError(
      "You already have a subscription in progress. Use Manage subscription.",
      409,
    );
  if (row.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      row.checkoutSessionId,
    );
    if (session.status === "open" && session.url) return session.url;
    if (session.status === "complete")
      throw new AppError(
        "Checkout completed. Wait for billing to sync, or use Manage subscription.",
        409,
      );
    db.update(subscriptions)
      .set({ checkoutKey: randomUUID(), checkoutSessionId: null })
      .where(
        and(
          eq(subscriptions.userId, user.id),
          eq(subscriptions.checkoutKey, row.checkoutKey),
        ),
      )
      .run();
    row = rowFor(user.id)!;
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: row.customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${appUrl()}/?checkout=returned`,
      cancel_url: `${appUrl()}/?checkout=cancelled`,
    },
    { idempotencyKey: row.checkoutKey },
  );
  db.update(subscriptions)
    .set({ checkoutSessionId: session.id })
    .where(eq(subscriptions.userId, user.id))
    .run();
  if (!session.url)
    throw new AppError("Stripe did not return a checkout URL.", 502);
  return session.url;
}
export async function openPortal(userId: string, stripe = stripeClient()) {
  const row = rowFor(userId);
  if (!row) throw new AppError("Start a subscription first.");
  const portal = await stripe.billingPortal.sessions.create({
    customer: row.customerId,
    return_url: appUrl(),
  });
  return portal.url;
}

// Read CURRENT Stripe state, not the event snapshot: deliveries can be reordered.
// A revision check retries if another handler applied a result while we fetched.
export async function applyStripeEvent(
  event: Stripe.Event,
  stripe = stripeClient(),
) {
  if (
    !new Set([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]).has(event.type)
  )
    return;
  if (event.livemode) throw new AppError("Live billing is not supported.");
  const source = event.data.object as Stripe.Subscription;
  const customerId =
    typeof source.customer === "string" ? source.customer : source.customer.id;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id)).get()
    )
      return;
    const row = db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.customerId, customerId))
      .get();
    if (!row) return; // Other customers in this Stripe sandbox do not belong to this app.
    const current = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    if (current.has_more)
      throw new AppError("Too many subscriptions for this small sample.", 503);
    const matching = current.data.filter((s) =>
      s.items.data.some((item) => item.price.id === priceId()),
    );
    const entitled = matching.filter(
      (s) => s.status === "active" || s.status === "trialing",
    );
    const subscription = (entitled.length ? entitled : matching).sort(
      (a, b) => b.created - a.created,
    )[0];
    const applied = db.transaction(
      (tx) => {
        if (
          tx
            .select()
            .from(stripeEvents)
            .where(eq(stripeEvents.id, event.id))
            .get()
        )
          return true;
        const fresh = tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, row.userId))
          .get()!;
        if (fresh.revision !== row.revision) return false;
        tx.update(subscriptions)
          .set({
            subscriptionId: subscription?.id ?? null,
            status: subscription?.status ?? "none",
            cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
            revision: row.revision + 1,
            ...(subscription?.status === "canceled"
              ? { checkoutSessionId: null, checkoutKey: randomUUID() }
              : {}),
          })
          .where(eq(subscriptions.userId, row.userId))
          .run();
        tx.insert(stripeEvents)
          .values({ id: event.id, type: event.type, processedAt: Date.now() })
          .run();
        return true;
      },
      { behavior: "immediate" },
    );
    if (applied) return;
  }
  throw new AppError(
    "Billing changed concurrently; Stripe should retry this event.",
    503,
  );
}
