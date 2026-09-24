# Tiny Notes — human answer sheet for Wittniz

Keep this outside the scanned source. App: `/home/ryuka/code/tiny-notes`. First scan: `/home/ryuka/code/tiny-notes/src`.

## What a human should understand in five minutes

A person registers and gets a session. That person writes private notes. A free account can keep three; a Pro account can keep twenty. Stripe handles checkout and subscription management. A verified Stripe webhook updates the locally stored subscription. Cancelling never deletes notes.

Try the app first: make Alice, create three notes, verify the fourth is blocked, log out, make Bob, verify Bob sees none of Alice's notes, log back in as Alice. Stripe test mode is optional for the initial code scan; no credentials are needed to understand the billing code. The README explains actual sandbox checkout.

## Exact database ground truth

All five app tables are declared in `src/server/schema.ts`. There are exactly **three declared foreign keys**, all pointing to users. Session and webhook event are technical records, not necessarily business concepts.

| Table | Purpose | Primary key | Declared foreign key |
| --- | --- | --- | --- |
| users | Account/email/password hash | id | none |
| sessions | Hashed login token and expiry | token_hash | user_id → users.id |
| notes | Private note text and creation time | id | user_id → users.id |
| subscriptions | Stripe customer/subscription and synchronized access status | user_id | user_id → users.id |
| stripe_events | IDs of processed subscription notifications | id | none |

Other exact constraints: users.email, subscriptions.customer_id and subscriptions.subscription_id are unique. Many notes and many sessions can belong to one user. At most one local subscription row belongs to a user. A user can have no subscription row. Stripe event IDs and customer IDs are external identifiers, not foreign keys to imaginary local Stripe tables. There is no local payments, invoices, plans or products table.

## Expected feature boundaries

These are a reference interpretation, not a required cluster count or required naming. Combining login and registration, for example, is reasonable if the evidence is right.

| Feature | Entry point | Core functions | Tables used |
| --- | --- | --- | --- |
| Account registration | POST /api/auth/signup | signUp → issueSession | users insert; sessions insert |
| Login / authentication | POST /api/auth/login; protected requests | logIn, sessionUser, requireUser | users read; sessions read/insert |
| Logout | POST /api/auth/logout | logOut | sessions delete |
| Read private notebook | GET / | currentUser, listNotes, planFor | sessions/users read; notes read; subscriptions read |
| Create note with plan quota | POST /api/notes | createNote → planFor | notes count/insert; subscriptions read |
| Delete own note | DELETE /api/notes/:id | deleteNote | notes delete filtered by both note and user |
| Subscribe to Pro | POST /api/billing/checkout | startCheckout | subscriptions read/insert/update; Stripe customer + Checkout API |
| Manage subscription | POST /api/billing/portal | openPortal | subscriptions read; Stripe portal API |
| Synchronize subscription | POST /api/stripe/webhook | verifyStripeEvent → applyStripeEvent | stripe_events read/insert; subscriptions read/update; Stripe subscription list API |

Check the shared helper relationships too: HTTP handlers call services; services access the DB. `schema.ts` defines tables; it is not a service that runs checkout. `notebook.tsx` submits browser requests; it does not directly access SQLite. The dynamic `[action]` routes dispatch to multiple known actions; they are not unlimited arbitrary actions.

A static analyzer may classify some transaction callback accesses as unresolved. That is a limitation to record against this source, not grounds to guess a confirmed query. Look for the real `tx.insert/update/select` sites as well as `db.*` sites. Counts may differ by the analyzer's definition of an access; inspect missing or spurious sites rather than demanding an undocumented magic total.

## Reasonable concepts and relationships

- **Account / User** owns **Note**.
- **Account** has an optional **Subscription**.
- **Subscription status** determines the note limit: Free 3, Pro 20.
- **Registration / Login** creates a **Session**; **Logout** invalidates it.
- **Checkout** starts the subscription purchase; a **verified subscription notification** synchronizes access.
- A **Note** is content, while **Create note** is an operation. A **login form** is a UI, while **Authentication** is a process. They should not be merged solely because their names or aliases overlap.

Free and Pro are rules in code, not rows in a plans table. Stripe and SQLite are infrastructure, not customer business concepts. The meaning of "subscription" must not be inferred to include invoicing or tax functionality that this source does not implement.

## Required behavioral facts to check in explanations

1. The current session determines the user; the browser cannot supply another user's ID to create/read/delete notes.
2. Passwords are salted/hashed, and only a hash of the random session token is stored. Sessions expire in seven days.
3. The quota is enforced in an immediate DB transaction, not just by a disabled Save button.
4. A checkout success URL does not grant Pro. Signed subscription notifications and current Stripe state do.
5. Only active/trialing subscriptions to the configured price grant Pro. Past due removes Pro under this app's intentionally strict rule.
6. Cancellation at period end retains access while active. Immediate cancellation removes Pro. Neither deletes existing notes.
7. Duplicate events are recorded once; a stale event reads current provider state. Concurrent reconciliation checks the row revision.
8. Other users/customers, unrelated prices, invalid signatures and live-mode billing must not grant access.
9. There is no AI, email sending, note sharing, note editing, search, team membership, or background job in this application.

For each claim Wittniz makes, open the cited source and ask: does that exact code support this statement? Mark supported / unsupported / missed / unclear. Separate accurate static facts from inferred business meaning and from your decision to adopt a concept.

## Suggested review order

1. Inventory: only the small runtime source is scanned; no node_modules, test doubles, generated output, answers or database contents.
2. ER: five tables and the three foreign keys above, with correct columns and ownership.
3. Accesses: list/create/delete notes and account/session/billing operations trace to the actual service functions.
4. Features: identify account access, private notes and subscriptions. Exact cluster labels/counts are flexible; unrelated ownership or fabricated operations are not.
5. Concepts: open Account, Note and Subscription, follow their evidence, then inspect their relationships. Do not auto-adopt or auto-merge merely to get a tidy graph.
6. Negative control: ask where note sharing or email verification happens. A correct answer says it is absent, rather than inventing implementation.

Record the app source version/date, Wittniz run ID, rule versions and screenshots alongside each comparison. Start with one unchanged snapshot. Only after it is understood, try a separately recorded change such as Free 3 → 4 to test whether updated evidence is recognized and older results stay historical. Do not change this baseline while another person is reviewing it.

This source is intentionally small and conventional. Success here is a baseline check, not validation of Prisma, PostgreSQL, documents, large repos, or every ontology inference. The app was not scanned through Wittniz as part of its creation, and no new Knowledge adoption or real-model run was authorized or performed.
