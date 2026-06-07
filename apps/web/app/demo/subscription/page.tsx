"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AdyenDropInBox } from "../../../components/AdyenDropInBox";
import { EventRow } from "../../../components/EventRow";
import { IdempotencyKeyDisplay } from "../../../components/IdempotencyKeyDisplay";
import { JsonBlock } from "../../../components/JsonBlock";
import { RoutingDecisionCard } from "../../../components/RoutingDecisionCard";
import { StripeCardBox } from "../../../components/StripeCardBox";
import {
  ApiRequestRecord,
  Provider,
  newIdempotencyKey,
  renewSubscription,
  replayWebhook,
  retryRequest,
  startSubscription
} from "../../../lib/api";

type ProviderChoice = "AUTO" | Provider;

export default function SubscriptionDemoPage() {
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>("AUTO");
  const [amount, setAmount] = useState(2500);
  const [currency, setCurrency] = useState("USD");
  const [email, setEmail] = useState("demo@example.com");
  const [customerId, setCustomerId] = useState("");
  const [providerCustomerId, setProviderCustomerId] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [paymentMethodId, setPaymentMethodId] = useState("pm_card_visa");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [rawWebhookEventId, setRawWebhookEventId] = useState("");
  const [lastRequest, setLastRequest] = useState<ApiRequestRecord | null>(null);
  const [lastStart, setLastStart] = useState<ApiRequestRecord | null>(null);
  const [lastRenew, setLastRenew] = useState<ApiRequestRecord | null>(null);
  const [replay, setReplay] = useState<ApiRequestRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const providerOverride = providerChoice === "AUTO" ? undefined : providerChoice;
  const activeSubscriptionId = subscriptionId || getResponseString(lastStart, "subscriptionId");
  const provider = getResponseString(lastStart, "provider") ?? providerOverride;
  const startChargeId = getResponseString(lastStart, "subscriptionChargeId");
  const renewChargeId = getResponseString(lastRenew, "subscriptionChargeId");
  const externalRef = getResponseString(lastRenew, "externalRef") ?? getResponseString(lastStart, "externalRef");
  const replayed = getResponseBoolean(lastRequest, "replayed");

  const handleAdyenPaymentMethod = useCallback((token: string) => {
    setPaymentMethodId(token);
  }, []);

  const startBody = useMemo(
    () => ({
      amount,
      currency,
      paymentMethodId,
      customerId: customerId || undefined,
      email: email || undefined,
      providerCustomerId: providerCustomerId || undefined,
      cadence,
      providerOverride,
      metadata: {
        source: "dashboard-subscription"
      }
    }),
    [amount, cadence, currency, customerId, email, paymentMethodId, providerCustomerId, providerOverride]
  );

  async function submitStart() {
    setBusy(true);
    const result = await startSubscription(startBody, newIdempotencyKey());
    setLastStart(result);
    setLastRequest(result);
    const newSubscriptionId = getResponseString(result, "subscriptionId");
    if (newSubscriptionId) {
      setSubscriptionId(newSubscriptionId);
    }
    setBusy(false);
  }

  async function submitRenew() {
    if (!activeSubscriptionId) {
      return;
    }

    setBusy(true);
    const result = await renewSubscription(
      activeSubscriptionId,
      {
        amount,
        metadata: {
          source: "dashboard-subscription"
        }
      },
      newIdempotencyKey()
    );
    setLastRenew(result);
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
    if (lastRequest.path === "/subscriptions/start") {
      setLastStart(result);
    } else {
      setLastRenew(result);
    }
    setBusy(false);
  }

  async function replaySameWebhook() {
    if (!rawWebhookEventId) {
      return;
    }

    setReplay(await replayWebhook(rawWebhookEventId));
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/">
        Back
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Subscription demo</h1>
        <p className="mt-2 text-sm">Run CIT setup, then MIT renewal with the stored payment method token.</p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <form className="grid gap-4 rounded border border-slate-300 p-4" onSubmit={(event) => event.preventDefault()}>
          <label className="grid gap-1 text-sm">
            Provider
            <select className="rounded border border-slate-300 p-2" value={providerChoice} onChange={(event) => setProviderChoice(event.target.value as ProviderChoice)}>
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
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Email
              <input className="rounded border border-slate-300 p-2" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Cadence
              <input className="rounded border border-slate-300 p-2" value={cadence} onChange={(event) => setCadence(event.target.value)} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Customer id
            <input className="rounded border border-slate-300 p-2" value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder="optional" />
          </label>
          <label className="grid gap-1 text-sm">
            Provider customer id
            <input className="rounded border border-slate-300 p-2" value={providerCustomerId} onChange={(event) => setProviderCustomerId(event.target.value)} placeholder="optional" />
          </label>
          <label className="grid gap-1 text-sm">
            Payment method id
            <input className="rounded border border-slate-300 p-2" value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Subscription id for MIT
            <input className="rounded border border-slate-300 p-2" value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)} placeholder="filled after CIT" />
          </label>

          {providerChoice === "ADYEN" ? (
            <AdyenDropInBox amount={amount} currency={currency} onPaymentMethod={handleAdyenPaymentMethod} />
          ) : (
            <StripeCardBox onPaymentMethod={setPaymentMethodId} />
          )}

          <div className="flex flex-wrap gap-3">
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={busy} type="button" onClick={submitStart}>
              POST /subscriptions/start
            </button>
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={busy || !activeSubscriptionId} type="button" onClick={submitRenew}>
              POST /subscriptions/{activeSubscriptionId || ":id"}/renew
            </button>
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={busy || !lastRequest?.idempotencyKey} type="button" onClick={retryLast}>
              Retry same API request
            </button>
          </div>
        </form>

        <div className="grid gap-4">
          <IdempotencyKeyDisplay idempotencyKey={lastRequest?.idempotencyKey} replayed={replayed} />
          <RoutingDecisionCard provider={provider} reason="Subscription provider follows the same route: EUR to Adyen, otherwise Stripe, unless overridden." externalRef={externalRef} />
        </div>
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Visible signals</h2>
        <EventRow label="Provider" value={provider} />
        <EventRow label="Subscription.status" value={getResponseString(lastStart, "status") ?? getResponseString(lastRenew, "status")} />
        <EventRow label="Subscription.id" value={activeSubscriptionId} />
        <EventRow label="CIT SubscriptionCharge.id" value={startChargeId} status="kind=CIT" />
        <EventRow label="MIT SubscriptionCharge.id" value={renewChargeId} status="kind=MIT" />
        <EventRow label="PaymentMethodToken.id" value={getResponseString(lastStart, "paymentMethodTokenId")} />
        <EventRow label="PSP external_ref" value={externalRef} />
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
          <h2 className="mb-2 text-lg font-semibold">CIT response</h2>
          <JsonBlock value={lastStart} />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">MIT response</h2>
          <JsonBlock value={lastRenew} />
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
