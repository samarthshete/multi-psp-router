# Architecture

multi-psp-router is organized around a small number of boundaries that keep provider-specific behavior from leaking into the core payment model. The NestJS API owns orchestration, validation, idempotency, and state transitions. Provider strategies own Stripe and Adyen SDK calls plus webhook normalization. Prisma owns the durable model, while `packages/shared` owns the TypeScript contracts that make provider behavior explicit.

The most important design choice is separating domain state from PSP operation state. A `PaymentOrder` or `Subscription` records the local business status. `PspOperation` records what was sent to a provider, with the request hash, idempotency key, response reference, response body, or failure. That split makes partial failure easier to reason about. A PSP call can fail after local records have been created, and the API can mark the operation failed without pretending the order never existed.

Routing is deliberately simple: override wins, EUR routes to Adyen, and other currencies route to Stripe. The router still writes `RoutingDecision` because the decision is part of the audit trail. Even simple routing logic becomes operationally meaningful when a disputed payment or webhook replay needs to explain why a provider was chosen.

Webhooks follow a two-stage model. First, the raw provider event is signature-checked and stored with a provider dedupe key. Second, the event is normalized into one or more `NormalizedPaymentEvent` records. The event ledger applies those normalized events through conditional updates, such as moving an order from `AUTH_PENDING` to `AUTHORIZED` only if it is still in that source state. This makes replay safe and keeps provider retries from causing duplicate transitions.

The dashboard intentionally has no auth and no backend read endpoints. It is a local demo and inspection surface, not an operator console. It records browser-side request history so idempotency and replay can be demonstrated even when read APIs are not yet implemented. The tradeoff is clear: the UI is useful for proving flows, but durable reporting should eventually come from explicit API read models.

The current architecture favors understandable durability over abstraction. There is enough structure to support two PSPs and subscriptions, but not so much framework machinery that the behavior is hidden.
