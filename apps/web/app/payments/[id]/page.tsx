"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventRow } from "../../../components/EventRow";
import { IdempotencyKeyDisplay } from "../../../components/IdempotencyKeyDisplay";
import { JsonBlock } from "../../../components/JsonBlock";
import { ProviderBadge } from "../../../components/ProviderBadge";
import { RoutingDecisionCard } from "../../../components/RoutingDecisionCard";
import {
  ApiRequestRecord,
  capturePayment,
  loadRequestHistory,
  newIdempotencyKey,
  replayWebhook,
  retryRequest
} from "../../../lib/api";

export default function PaymentDetailPage({
  params
}: {
  params: {
    id: string;
  };
}) {
  const [history, setHistory] = useState<ApiRequestRecord[]>([]);
  const [amount, setAmount] = useState("");
  const [rawWebhookEventId, setRawWebhookEventId] = useState("");
  const [lastCapture, setLastCapture] = useState<ApiRequestRecord | null>(null);
  const [lastReplay, setLastReplay] = useState<ApiRequestRecord | null>(null);
  const [lastRetry, setLastRetry] = useState<ApiRequestRecord | null>(null);

  useEffect(() => {
    setHistory(loadRequestHistory());
  }, []);

  const paymentRecord = useMemo(() => {
    const records = history.filter((record) => {
      const response = record.response;
      if (!response || typeof response !== "object") {
        return false;
      }

      const paymentOrderId = (response as Record<string, unknown>).paymentOrderId;
      return params.id === "latest" ? Boolean(paymentOrderId) : paymentOrderId === params.id;
    });

    return records[0] ?? null;
  }, [history, params.id]);

  const paymentOrderId = getResponseString(paymentRecord, "paymentOrderId") ?? (params.id === "latest" ? "" : params.id);
  const provider = getResponseString(paymentRecord, "provider");
  const status = getResponseString(lastCapture, "status") ?? getResponseString(paymentRecord, "status");
  const externalRef = getResponseString(lastCapture, "externalRef") ?? getResponseString(paymentRecord, "externalRef");

  async function submitCapture() {
    if (!paymentOrderId) {
      return;
    }

    const result = await capturePayment(
      paymentOrderId,
      {
        amount: amount ? Number(amount) : undefined,
        metadata: {
          source: "dashboard-payment-detail"
        }
      },
      newIdempotencyKey()
    );
    setLastCapture(result);
    setHistory(loadRequestHistory());
  }

  async function replaySameWebhook() {
    if (!rawWebhookEventId) {
      return;
    }

    setLastReplay(await replayWebhook(rawWebhookEventId));
    setHistory(loadRequestHistory());
  }

  async function retryLatestPaymentRequest() {
    if (!paymentRecord?.idempotencyKey) {
      return;
    }

    setLastRetry(await retryRequest(paymentRecord));
    setHistory(loadRequestHistory());
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/">
        Back
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Payment {params.id}</h1>
        <p className="mt-2 text-sm">This page uses browser-recorded demo responses because the API does not expose a payment detail read endpoint yet.</p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded border border-slate-300 p-4">
          <h2 className="text-lg font-semibold">Payment actions</h2>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm">
              Capture amount
              <input className="rounded border border-slate-300 p-2" min={1} type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="defaults to order amount" />
            </label>
            <div className="flex flex-wrap gap-3">
              <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={!paymentOrderId} type="button" onClick={submitCapture}>
                POST /payments/{paymentOrderId || ":id"}/capture
              </button>
              <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={!paymentRecord?.idempotencyKey} type="button" onClick={retryLatestPaymentRequest}>
                Retry same API request
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <IdempotencyKeyDisplay idempotencyKey={lastCapture?.idempotencyKey ?? paymentRecord?.idempotencyKey} replayed={getReplayFlag(lastRetry)} />
          <RoutingDecisionCard provider={provider} paymentOrderId={paymentOrderId} externalRef={externalRef} />
        </div>
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Visible signals</h2>
        <EventRow label="Provider" value={provider} />
        <EventRow label="PaymentOrder.id" value={paymentOrderId} />
        <EventRow label="PaymentOrder.status" value={status} />
        <EventRow label="Capture.id" value={getResponseString(lastCapture, "captureId")} />
        <EventRow label="PSP external_ref" value={externalRef} />
        <EventRow label="Detail source" value={paymentRecord ? "browser request history" : "none"} />
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Replay same webhook</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <input className="min-w-80 rounded border border-slate-300 p-2 text-sm" value={rawWebhookEventId} onChange={(event) => setRawWebhookEventId(event.target.value)} placeholder="RawWebhookEvent id" />
          <button className="rounded border border-slate-400 px-3 py-2 text-sm" type="button" onClick={replaySameWebhook}>
            POST /dev/replay-webhook
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Payment record</h2>
          <ProviderBadge provider={provider} />
          <div className="mt-3">
            <JsonBlock value={paymentRecord} />
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Capture response</h2>
          <JsonBlock value={lastCapture} />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Webhook replay</h2>
          <JsonBlock value={lastReplay} />
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

function getReplayFlag(record: ApiRequestRecord | null) {
  const response = record?.response;
  return Boolean(response && typeof response === "object" && (response as Record<string, unknown>).replayed);
}
