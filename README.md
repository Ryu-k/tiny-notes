# Tiny Notes

A deliberately small Next.js + Drizzle + SQLite application for manually checking Wittniz's analysis. Register an account, keep private notes, and subscribe through Stripe Checkout. No AI, background worker, external database, or model calls.

## Run

Node 22+ and pnpm are required. From this directory:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:3711** (use this exact host so the Origin check matches). Register any test email and a password of at least 12 characters. There are no seeded accounts. This app has its own `data/tiny-notes.sqlite`; it never uses Wittniz's database or port.

The dependencies are installed in the delivered copy. `.env.local` is initially configured for the free app, with Stripe blank. Migration is repeatable. `pnpm build && pnpm start` runs the production build on the same port; stop dev first. To change the host/port, change both `APP_URL` and the launch command. Keep it bound to localhost.

## The entire product

- Sign up with email/password, log in, log out. Sessions expire after seven days.
- Each account owns its notes. Create, list, and delete; no sharing or editing.
- Free: **3 notes**. Pro: **20 notes**. Each note is 1–500 characters.
- Stripe `active` or `trialing` subscriptions to the configured price enable Pro.
- `past_due`, `unpaid`, canceled and other non-entitled states use Free. Cancellation at period end retains Pro while active. Downgrading never deletes existing notes; it blocks new notes until below the free limit.
- Stripe's hosted customer portal manages cancellation. A completed checkout redirect alone never enables Pro. Click **Refresh plan** after Stripe delivers the webhook.

This is a local evaluation application, not a production SaaS starter. Intentionally omitted: email verification, password reset/email delivery, social login, account deletion, teams, tax handling, multiple products, coupons, and production/distributed rate limiting. Authentication has salted scrypt hashes, hashed random sessions, HttpOnly/SameSite cookies, expiry, same-origin mutations and a small single-process login throttle. Stripe **live keys/events are refused**.

## Optional Stripe test subscription

The free app requires no Stripe account. To exercise actual hosted checkout:

1. Use a Stripe sandbox/test account. Create one product called **Tiny Notes Pro** and one recurring monthly price, for example USD 5. Copy its `price_…` ID. Enable the customer portal and subscription cancellation in that same sandbox.
2. Set `STRIPE_SECRET_KEY=sk_test_…` and `STRIPE_PRICE_ID=price_…` in `.env.local`. Do not put secrets in code or commit this file.
3. Install/authenticate the Stripe CLI yourself, then run:

   ```sh
   stripe listen --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to http://127.0.0.1:3711/api/stripe/webhook
   ```

4. Put the listener's `whsec_…` value in `STRIPE_WEBHOOK_SECRET`. Restart the app after changing environment values.
5. Register/log in and choose **Get Pro**. Use Stripe's test card `4242 4242 4242 4242`, a future expiry and any test CVC. Never enter real card details. The checkout shows the price you configured.
6. Return and click **Refresh plan**. It should show Pro / 20 notes after the signed event is processed. Use **Manage subscription** to cancel; refresh after the event. For immediate downgrade testing, cancel the test subscription immediately in the Stripe sandbox; period-end cancellation intentionally retains access until the period ends.

Webhook events are signature-verified against the raw body. The handler identifies accounts through the previously stored Stripe customer ID, fetches current subscription state (rather than trusting event order), checks the configured price, and atomically records the event ID and entitlement update. Duplicate events do not apply twice. A database revision check retries conflicting fetches. The Checkout session is reused while open; the server fixes the price and quantity.

The SDK is pinned to Stripe 20.4.1 (API `2026-02-25.clover`). Configure a manually created webhook destination to the matching API version. The app is intentionally limited to one product; it refuses to reconcile more than 100 subscription records for a customer. If webhooks are unavailable the stored entitlement can lag: restore the listener and resend the failed event from Stripe. This small app has no reconciliation worker.

References: [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe Checkout sessions](https://docs.stripe.com/api/checkout/sessions), [Drizzle SQLite setup](https://orm.drizzle.team/docs/get-started/sqlite-new). Next.js APIs were checked against the installed package documentation.

## Check it

```sh
pnpm check                 # TypeScript + offline service tests
pnpm build
pnpm exec playwright install chromium  # Only if the browser is not installed
pnpm test:browser          # Production app on port 3713; fresh temporary DB
```

Tests do not contact Stripe or any model. Service tests use explicit Stripe doubles and real local signature verification. Browser checks cover sign-up/login/logout, persistence, quota enforcement, cross-origin rejection, isolation, deletion confirmation and a narrow viewport. They stop only their own server and remove only their own temporary database. Screenshots and server logs go in `.artifacts/`. The app's ordinary database is not used by either test.

## Scan with Wittniz

For the first, blind code scan, register **`/home/ryuka/code/tiny-notes/src`**. It contains the whole runtime application and Drizzle schema, but no answer sheet or test doubles. Alternatively register the root as code and exclude `node_modules`, `.next`, `data`, `.artifacts`, `tests`, `scripts`, and documentation. Do not feed the SQLite file, environment files, or generated bundles into analysis.

The separate **[human review guide](docs/wittniz-review-guide.md)** is your answer sheet. Read it after scanning, not as input to the first scan. It distinguishes exact structural facts from reasonable business interpretations. A tiny app is useful for exposing errors; it does not prove that analysis works at large scale.
