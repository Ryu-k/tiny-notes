import { applyStripeEvent } from "../../../../server/billing";
import { verifyStripeEvent } from "../../../../server/stripe";
import { respond } from "../../../../server/http";
export async function POST(request: Request) {
  return respond(async () => {
    // Stripe authenticates with the signature, not a browser session or Origin.
    const event = verifyStripeEvent(
      await request.text(),
      request.headers.get("stripe-signature") ?? "",
    );
    await applyStripeEvent(event);
    return { received: true };
  });
}
