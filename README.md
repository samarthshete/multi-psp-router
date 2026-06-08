# multi-psp-router

multi-psp-router is a TypeScript pnpm monorepo for routing payments and subscription renewals across multiple payment service providers. It contains a NestJS API, a Next.js App Router dashboard, a Prisma/Postgres data package, and shared provider contracts. The implementation is intentionally small but production-shaped: API requests are idempotent, PSP operations are recorded separately from domain state, webhooks normalize provider-specific payloads into a common event ledger, and the dashboard exposes the signals needed to inspect routing, replay, and dedupe behavior.

## Architecture

```text
                         +---------------------------+
                         | apps/web Next.js dashboard|
                         | no auth, demo controls    |
                         +-------------+-------------+
                                       |
                                       | fetch + Idempotency-Key
                                       v
+-------------------+     +-----------+------------+      +-------------------+
| Stripe sandbox    |<--->| apps/api NestJS        |<---->| Adyen checkout    |
| PaymentIntent     |     | controllers + services |      | payments/webhooks |
+---------+---------+     +-----------+------------+      +---------+---------+
          |                           |                             |
          | webhooks                  | Prisma client               | webhooks
          v                           v                             v
   +------+---------------------------+-----------------------------+------+
   | packages/db Postgres schema: orders, attempts, captures, subscriptions,|
   | idempotency records, raw webhooks, normalized events, operations       |
   +--------------------------+---------------------------------------------+
                              |
                              v
                    +---------+---------+
                    | packages/shared   |
                    | strategy contracts|
                    +-------------------+
```

The same diagram is also available as `docs/architecture.png`.

## Workspace

- `apps/api`: NestJS 10 API with health, payments, subscriptions, idempotency, webhooks, events, and dev replay modules.
- `apps/web`: Next.js 14 App Router dashboard using Tailwind defaults, Stripe Elements, and Adyen Web Drop-in.
- `packages/db`: Prisma schema and generated client wrapper exported as `@router/db`.
- `packages/shared`: provider strategy interfaces and normalized event types exported as `@router/shared`.
- `packages/config`: shared TypeScript configuration.

## Core Flows

Payment authorization starts at `POST /payments/auth-hold`. The API hashes the request body, records an idempotency row, writes a `PaymentOrder`, chooses a provider with the router, records the `RoutingDecision`, and calls the selected strategy. Capture follows `POST /payments/:id/capture`, records a `Capture`, and leaves settlement to the webhook ledger.

Subscriptions split customer-initiated setup and merchant-initiated renewal. `POST /subscriptions/start` creates or reuses a customer, stores a payment method token, writes a CIT `SubscriptionCharge`, and activates the subscription on PSP success. `POST /subscriptions/:id/renew` writes a MIT charge, calls the PSP with the stored method, and relies on a normalized webhook to settle the charge as succeeded or failed.

Webhook ingestion keeps raw provider payloads separate from normalized domain events. Stripe and Adyen signatures are verified before inserting `RawWebhookEvent`; uniqueness on `(provider, dedupeKey)` makes duplicate provider deliveries harmless. Processing can run inline or via manual drain. Normalized events are upserted by `(rawWebhookId, type)` and then applied through idempotent conditional updates in `EventLedgerService`.

## Environment

Create `.env.local` at the repository root for local API work:

```bash
DATABASE_URL=
DIRECT_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ADYEN_CHECKOUT_KEY=
ADYEN_MERCHANT_ACCOUNT=
ADYEN_HMAC_KEY=
DEMO_MODE=
WEBHOOK_PROCESSING_MODE=manual_drain
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_ADYEN_CLIENT_KEY=
```

Set `DEMO_MODE=adyen_replay` to exercise the Adyen strategy without Adyen credentials. Stripe still needs real test-mode keys for live sandbox PaymentIntent creation.

## Running Locally

```bash
corepack pnpm install
corepack pnpm --filter @router/db db:generate
corepack pnpm --filter @router/db db:migrate dev --name init
corepack pnpm dev
```

The API normally serves on port `3000`; the dashboard can run on another port if needed with `corepack pnpm --filter web exec next dev -H 127.0.0.1 -p 3001`.

## Testing

```bash
corepack pnpm test
corepack pnpm --filter api test
corepack pnpm --filter web build
```

The unit suite covers idempotency replay/conflict/in-progress/failure, router provider choice, Stripe and Adyen strategy payloads and normalization, controller persistence on happy and failure paths, raw webhook dedupe/manual drain/inline processing, replay endpoints, and ledger transitions. End-to-end PSP checks require a real Postgres database and sandbox credentials.

## Dashboard

The dashboard is deliberately plain. It exposes request and response bodies, provider choice, routing decision, PSP external references, local entity ids, idempotency keys, replay flags, webhook replay controls, and recent browser-side request history. It is not an admin console; it is a signal surface for proving the router behavior during local demos.

## Production Readiness

- Repository: https://github.com/samarthshete/multi-psp-router
- Live demo: https://multi-psp-router-web.vercel.app
- API: https://multi-psp-router-api.onrender.com
- Loom walkthrough: pending recording URL
- Web deploy config: `vercel.json`
- API deploy config: `render.yaml`
- Smoke test: `bash scripts/smoke-test.sh https://multi-psp-router-api.onrender.com`

### Deployment Environment

Configure these in the Vercel web project:

```bash
NEXT_PUBLIC_API_BASE_URL=https://multi-psp-router-api.onrender.com
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<stripe publishable test key>
NEXT_PUBLIC_ADYEN_CLIENT_KEY=
```

Configure these in the Render API service:

```bash
DATABASE_URL=<supabase transaction pooler url>
DIRECT_URL=<supabase direct url for migrations>
CORS_ORIGIN=https://multi-psp-router-web.vercel.app
STRIPE_SECRET_KEY=<stripe secret test key>
STRIPE_WEBHOOK_SECRET=<stripe webhook signing secret>
ADYEN_CHECKOUT_KEY=
ADYEN_MERCHANT_ACCOUNT=
ADYEN_HMAC_KEY=
DEMO_MODE=adyen_replay
WEBHOOK_PROCESSING_MODE=inline
HOST=0.0.0.0
```

### §21 Checklist

- [x] Production deploy config exists for web and API.
- [x] Web project deployed to Vercel.
- [x] API project deployed to Render.
- [x] Production env vars configured in both projects.
- [x] Stripe webhook registered to `/webhooks/stripe`.
- [ ] Adyen live webhook registered to `/webhooks/adyen`, or `DEMO_MODE=adyen_replay` explicitly used.
- [x] Adyen live webhook skipped; `DEMO_MODE=adyen_replay` is explicitly used.
- [x] Deployed auth-capture smoke test passed.
- [ ] Loom walkthrough recorded and linked.
- [x] Git history secret scan passed.
