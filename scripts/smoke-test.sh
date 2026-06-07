#!/usr/bin/env bash
set -euo pipefail

API_URL="${1:-}"

if [ -z "$API_URL" ]; then
  echo "usage: scripts/smoke-test.sh <deployed-api-url>" >&2
  exit 2
fi

API_URL="${API_URL%/}"

echo "Checking health at $API_URL/health"
HEALTH="$(node -e "
const url = process.argv[1];
(async () => {
  const response = await fetch(url + '/health');
  const body = await response.text();
  console.log(response.status + ' ' + body);
  if (!response.ok) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
" "$API_URL")"
echo "$HEALTH"

PAYMENT_METHOD_ID="${SMOKE_PAYMENT_METHOD_ID:-pm_card_visa}"
IDEMPOTENCY_KEY="smoke-auth-$(date +%s)"

echo "Creating auth hold with Idempotency-Key $IDEMPOTENCY_KEY"
AUTH_RESPONSE="$(node -e "
const [url, paymentMethodId, idempotencyKey] = process.argv.slice(1);
(async () => {
  const response = await fetch(url + '/payments/auth-hold', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      amount: 100,
      currency: 'USD',
      paymentMethodId,
      metadata: {
        source: 'production-smoke-test'
      }
    })
  });
  const body = await response.text();
  console.log(body);
  if (!response.ok) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
" "$API_URL" "$PAYMENT_METHOD_ID" "$IDEMPOTENCY_KEY")"
echo "$AUTH_RESPONSE"

PAYMENT_ORDER_ID="$(node -e "
const payload = JSON.parse(process.argv[1]);
if (!payload.paymentOrderId) process.exit(1);
console.log(payload.paymentOrderId);
" "$AUTH_RESPONSE")"

CAPTURE_IDEMPOTENCY_KEY="smoke-capture-$(date +%s)"

echo "Capturing payment order $PAYMENT_ORDER_ID with Idempotency-Key $CAPTURE_IDEMPOTENCY_KEY"
node -e "
const [url, paymentOrderId, idempotencyKey] = process.argv.slice(1);
(async () => {
  const response = await fetch(url + '/payments/' + encodeURIComponent(paymentOrderId) + '/capture', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      metadata: {
        source: 'production-smoke-test'
      }
    })
  });
  const body = await response.text();
  console.log(body);
  if (!response.ok) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
" "$API_URL" "$PAYMENT_ORDER_ID" "$CAPTURE_IDEMPOTENCY_KEY"

echo "Smoke test passed"
