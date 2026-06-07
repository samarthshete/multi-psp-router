# Webhook Normalization

Webhook normalization exists because Stripe and Adyen describe similar business facts with different event names, payload shapes, signature mechanisms, and dedupe identifiers. The API therefore treats provider webhooks as raw input first, then converts them into a shared event vocabulary before touching domain state.

Ingestion verifies the provider signature and inserts a `RawWebhookEvent` with `provider`, `dedupeKey`, `signatureValid`, and the original payload. Stripe uses the event id as the dedupe key. Adyen computes a SHA-256 key from event code, PSP reference, original reference, success flag, and event date. The database enforces uniqueness on `(provider, dedupeKey)`, which means repeated provider deliveries are accepted without reprocessing. Stripe duplicates return `{ duplicate: true }`; Adyen still returns `[accepted]`, matching the provider's expected acknowledgement style.

Normalization is handled by provider strategies. Stripe maps `payment_intent.amount_capturable_updated` to `PAYMENT_AUTHORIZED`, capture success to `PAYMENT_CAPTURED`, payment failure to `PAYMENT_FAILED`, and metadata-marked subscription events to `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_RENEWED`, or `SUBSCRIPTION_PAYMENT_FAILED`. Adyen maps `AUTHORISATION`, `CAPTURE`, recurring-contract, and dispute events similarly, with subscription ids inferred from merchant references such as `subscription:<id>` or `subscription_charge:<id>`.

The normalized event is upserted by `(rawWebhookId, type)` before the ledger applies it. This is a deliberate second layer of idempotency. The raw event uniqueness handles provider retries; the normalized event uniqueness handles replay of an already-stored raw event. Dev endpoints can replay one raw event or drain all unprocessed raw events, and repeated replay should not create duplicate transitions.

The ledger applies events through conditional updates instead of blind writes. For example, authorization only moves `AUTH_PENDING` orders to `AUTHORIZED`, and renewal success only moves pending subscription charges to `SUCCEEDED`. This makes event ordering and replay less dangerous. A late duplicate cannot move a captured payment backward or repeatedly settle a charge.

The tradeoff is that normalization requires good metadata. Subscription webhook handling depends on ids passed in PSP metadata or references. That is acceptable for this project because the API controls the outgoing PSP calls, but production systems should monitor missing metadata as an operational error rather than treating it as harmless noise.
