import Stripe from "stripe";
import { AppError } from "./errors";

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new AppError(
      "Configure a Stripe test secret key to use billing.",
      503,
    );
  return new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });
}
export function priceId() {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id?.startsWith("price_"))
    throw new AppError("Configure the recurring Stripe test price.", 503);
  return id;
}
export function appUrl() {
  return process.env.APP_URL || "http://127.0.0.1:3711";
}
export function verifyStripeEvent(raw: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret?.startsWith("whsec_"))
    throw new AppError("Stripe webhook is not configured.", 503);
  try {
    const event = stripeClient().webhooks.constructEvent(
      raw,
      signature,
      secret,
    );
    if (event.livemode) throw new Error("Live events are not supported.");
    return event;
  } catch {
    throw new AppError("Invalid Stripe signature or event.", 400);
  }
}
