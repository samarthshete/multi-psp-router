"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdyenDropInBox } from "../../../components/AdyenDropInBox";
import { EventRow } from "../../../components/EventRow";
import { IdempotencyKeyDisplay } from "../../../components/IdempotencyKeyDisplay";
import { JsonBlock } from "../../../components/JsonBlock";
import { ProviderBadge } from "../../../components/ProviderBadge";
import { RoutingDecisionCard } from "../../../components/RoutingDecisionCard";
import { StripeCardBox } from "../../../components/StripeCardBox";
import {
  ApiRequestRecord,
  Provider,
  capturePayment,
  createAuthHold,
  loadRequestHistory,
  newIdempotencyKey,
  replayWebhook,
  retryRequest
} from "../../../lib/api";

type ProviderChoice = "AUTO" | Provider;

export default function AuthCapturePage() {
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>("AUTO");
  const [amount, setAmount] = useState(1099);
  const [currency, setCurrency] = useState("USD");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("pm_card_visa");
  const [rawWebhookEventId, setRawWebhookEventId] = useState("");
  const [lastRequest, setLastRequest] = useState<ApiRequestRecord | null>(null);
  const [lastAuth, setLastAuth] = useState<ApiRequestRecord | null>(null);
  const [lastCapture, setLastCapture] = useState<ApiRequestRecord | null>(null);
  const [replay, setReplay] = useState<ApiRequestRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const providerOverride = providerChoice === "AUTO" ? undefined : providerChoice;
  const paymentOrderId = getResponseString(lastAuth, "paymentOrderId");
  const captureId = getResponseString(lastCapture, "captureId");
  const provider = getResponseString(lastAuth, "provider") ?? providerOverride;
  const externalRef = getResponseString(lastCapture, "externalRef") ?? getResponseString(lastAuth, "externalRef");
  const replayed = getResponseBoolean(lastRequest, "replayed");

  const handleAdyenPaymentMethod = useCallback((token: string) => {
    setPaymentMethodId(token);
  }, []);

  useEffect(() => {
    const history = loadRequestHistory();
    const auth = history.find((record) => record.path === "/payments/auth-hold");
    const capture = history.find((record) => record.path.includes("/capture"));

    setLastAuth(auth ?? null);
    setLastCapture(capture ?? null);
    setLastRequest(capture ?? auth ?? null);
  }, []);

  const requestBody = useMemo(
    () => ({
      amount,
      currency,
      paymentMethodId,
      customerId: customerId || undefined,
      providerOverride,
      metadata: {
        source: "dashboard-auth-capture"
      }
    }),
    [amount, currency, customerId, paymentMethodId, providerOverride]
  );

  async function submitAuthHold() {
    setBusy(true);
    const idempotencyKey = newIdempotencyKey();
    const result = await createAuthHold(requestBody, idempotencyKey);
    setLastAuth(result);
    setLastRequest(result);
    setBusy(false);
  }

  async function submitCapture() {
    if (!paymentOrderId) {
      return;
    }

    setBusy(true);
    const idempotencyKey = newIdempotencyKey();
    const result = await capturePayment(
      paymentOrderId,
      {
        amount,
        metadata: {
          source: "dashboard-auth-capture"
        }
      },
      idempotencyKey
    );
    setLastCapture(result);
    setLastRequest(result);
    setBusy(false);
  }

  async function retryLast() {
    if (!lastRequest) {
      return;
    }

    setBusy(true);
    const result = await retryRequest(lastRequest);
    setLastRequest(result);
    if (lastRequest.path === "/payments/auth-hold") {
      setLastAuth(result);
    } else {
      setLastCapture(result);
    }
    setBusy(false);
  }

  async function replaySameWebhook() {
    if (!rawWebhookEventId) {
      return;
    }

    const result = await replayWebhook(rawWebhookEventId);
    setReplay(result);
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/">
        Back
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Auth and capture demo</h1>
        <p className="mt-2 text-sm">Create an authorization hold, capture it, then replay the same API or webhook signal.</p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <form className="grid gap-4 rounded border border-slate-300 p-4" onSubmit={(event) => event.preventDefault()}>
          <label className="grid gap-1 text-sm">
            Provider
            <select
              className="rounded border border-slate-300 p-2"
              value={providerChoice}
              onChange={(event) => setProviderChoice(event.target.value as ProviderChoice)}
            >
              <option value="AUTO">Auto route</option>
              <option value="STRIPE">Stripe override</option>
              <option value="ADYEN">Adyen override</option>
            </select>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Amount
              <input className="rounded border border-slate-300 p-2" min={1} type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
            </label>
            <label className="grid gap-1 text-sm">
              Currency
              <input className="rounded border border-slate-300 p-2 uppercase" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Customer id
            <input className="rounded border border-slate-300 p-2" value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder="optional" />
          </label>
          <label className="grid gap-1 text-sm">
            Payment method id
            <input className="rounded border border-slate-300 p-2" value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)} />
          </label>

          {providerChoice === "ADYEN" ? (
            <AdyenDropInBox amount={amount} currency={currency} onPaymentMethod={handleAdyenPaymentMethod} />
          ) : (
            <StripeCardBox onPaymentMethod={setPaymentMethodId} />
          )}

          <div className="flex flex-wrap gap-3">
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={busy} type="button" onClick={submitAuthHold}>
              POST /payments/auth-hold
            </button>
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={busy || !paymentOrderId} type="button" onClick={submitCapture}>
              POST /payments/{paymentOrderId || ":id"}/capture
            </button>
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={busy || !lastRequest?.idempotencyKey} type="button" onClick={retryLast}>
              Retry same API request
            </button>
          </div>
        </form>

        <div className="grid gap-4">
          <IdempotencyKeyDisplay idempotencyKey={lastRequest?.idempotencyKey} replayed={replayed} />
          <RoutingDecisionCard provider={provider} paymentOrderId={paymentOrderId} externalRef={externalRef} />
        </div>
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Visible signals</h2>
        <EventRow label="Provider" value={provider} status={provider ? "" : "pending"} />
        <EventRow label="PaymentOrder.status" value={getResponseString(lastAuth, "status")} />
        <EventRow label="Capture.status" value={getResponseString(lastCapture, "status")} />
        <EventRow label="PaymentOrder.id" value={paymentOrderId} />
        <EventRow label="Capture.id" value={captureId} />
        <EventRow label="PSP external_ref" value={externalRef} />
        <EventRow label="HTTP status" value={lastRequest?.status} status={lastRequest?.ok ? "ok" : "error"} />
        <EventRow label="Last Idempotency-Key" value={lastRequest?.idempotencyKey} />
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Replay same webhook</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <input className="min-w-80 rounded border border-slate-300 p-2 text-sm" value={rawWebhookEventId} onChange={(event) => setRawWebhookEventId(event.target.value)} placeholder="RawWebhookEvent id" />
          <button className="rounded border border-slate-400 px-3 py-2 text-sm" type="button" onClick={replaySameWebhook}>
            POST /dev/replay-webhook
          </button>
        </div>
        <div className="mt-4">
          <JsonBlock value={replay?.response ?? replay?.error ?? null} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Auth response</h2>
          <ProviderBadge provider={provider} />
          <div className="mt-3">
            <JsonBlock value={lastAuth} />
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Capture response</h2>
          <JsonBlock value={lastCapture} />
        </div>
      </section>
    </main>
  );
}

function getResponseString(record: ApiRequestRecord | null, key: string) {
  const response = record?.response;
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const value = (response as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getResponseBoolean(record: ApiRequestRecord | null, key: string) {
  const response = record?.response;
  if (!response || typeof response !== "object") {
    return false;
  }
  return (response as Record<string, unknown>)[key] === true;
}
