"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventRow } from "../../components/EventRow";
import { JsonBlock } from "../../components/JsonBlock";
import {
  ApiRequestRecord,
  loadRequestHistory,
  processWebhookJobs,
  replayWebhook
} from "../../lib/api";

export default function EventsPage() {
  const [rawWebhookEventId, setRawWebhookEventId] = useState("");
  const [lastReplay, setLastReplay] = useState<ApiRequestRecord | null>(null);
  const [lastDrain, setLastDrain] = useState<ApiRequestRecord | null>(null);
  const [history, setHistory] = useState<ApiRequestRecord[]>([]);

  useEffect(() => {
    setHistory(loadRequestHistory());
  }, []);

  const eventHistory = useMemo(
    () =>
      history.filter(
        (record) =>
          record.path.includes("webhook") ||
          JSON.stringify(record.response ?? {}).includes("NormalizedPaymentEvent")
      ),
    [history]
  );

  async function replayOne() {
    if (!rawWebhookEventId) {
      return;
    }

    const result = await replayWebhook(rawWebhookEventId);
    setLastReplay(result);
    setHistory(loadRequestHistory());
  }

  async function drainJobs() {
    const result = await processWebhookJobs();
    setLastDrain(result);
    setHistory(loadRequestHistory());
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/">
        Back
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Events</h1>
        <p className="mt-2 text-sm">Inspect manual webhook normalization, raw event replay, dedupe results, and ledger processing responses.</p>
      </header>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Webhook controls</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <input className="min-w-80 rounded border border-slate-300 p-2 text-sm" value={rawWebhookEventId} onChange={(event) => setRawWebhookEventId(event.target.value)} placeholder="RawWebhookEvent id" />
          <button className="rounded border border-slate-400 px-3 py-2 text-sm" type="button" onClick={replayOne}>
            Replay same webhook
          </button>
          <button className="rounded border border-slate-400 px-3 py-2 text-sm" type="button" onClick={drainJobs}>
            POST /dev/process-webhook-jobs
          </button>
        </div>
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Visible signals</h2>
        <EventRow label="RawWebhookEvent.id" value={rawWebhookEventId} />
        <EventRow label="Replay HTTP status" value={lastReplay?.status} status={lastReplay?.ok ? "ok" : "error"} />
        <EventRow label="Drain HTTP status" value={lastDrain?.status} status={lastDrain?.ok ? "ok" : "error"} />
        <EventRow label="Processing mode" value="WEBHOOK_PROCESSING_MODE inline or manual_drain" />
        <EventRow label="Duplicate behavior" value="unique(provider, dedupeKey)" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Replay response</h2>
          <JsonBlock value={lastReplay} />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Drain response</h2>
          <JsonBlock value={lastDrain} />
        </div>
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Recent local event calls</h2>
        <div className="mt-2">
          {eventHistory.length === 0 ? (
            <p className="text-sm">No webhook calls recorded in this browser yet.</p>
          ) : (
            eventHistory.map((record) => (
              <EventRow
                key={record.id}
                label={record.label}
                value={`${record.method} ${record.path}`}
                status={record.ok ? "ok" : "error"}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
