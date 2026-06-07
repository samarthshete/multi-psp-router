# Idempotency

Idempotency is handled at the API service layer rather than inside individual controllers or provider strategies. Each request that mutates payment state provides an `Idempotency-Key` header. The controller computes a canonical JSON hash of the request body and calls `IdempotencyService.runOnce(scope, key, bodyHash, handler)`. The scope is part of the identity, so the same key can be reused safely by unrelated operations while remaining strict within a single operation class.

The service stores an `IdempotencyRecord` with status `IN_PROGRESS` before running the handler. If the same scope and key arrive with the same body hash after completion, the cached status and response body are returned with `replayed: true`. If the body hash differs, the service throws a 409 conflict. If the original request is still in progress, it also returns a 409, but with a distinct message: `Request still in progress`.

The canonical hash is important. JavaScript object key order should not decide whether two requests are equivalent. The helper sorts object keys recursively, serializes the canonical structure, and hashes it with SHA-256. This keeps retries stable across clients that may emit the same JSON fields in different orders.

The main tradeoff is that idempotency records are written before the rest of the local transaction work, but the current implementation does not wrap every downstream write and PSP call in a single database transaction. That is intentional for now because PSP calls cannot participate in database transactions anyway. Instead, the system records local intent, records PSP operations separately, and marks the idempotency record failed if the handler throws. This gives operators enough information to inspect partial progress without creating a false sense of atomicity.

The design also stores response bodies directly in the idempotency table. That is practical for small API responses and local demos. For higher-volume production use, large bodies, retention policy, and personally identifiable metadata would need stricter controls. The current response shape is compact: entity ids, provider, status, external PSP reference, and replay flag.

The dashboard exposes the last idempotency key per request and includes a proof page. Retrying the same recorded request reuses the same key and body, while the conflict action reuses the same key with a changed body. That makes the intended behavior visible without hiding the mechanics.
