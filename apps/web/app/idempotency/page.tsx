"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventRow } from "../../components/EventRow";
import { IdempotencyKeyDisplay } from "../../components/IdempotencyKeyDisplay";
import { JsonBlock } from "../../components/JsonBlock";
import {
  ApiRequestRecord,
  apiFetch,
  loadRequestHistory,
  retryRequest
} from "../../lib/api";

export default function IdempotencyPage() {
  const [history, setHistory] = useState<ApiRequestRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [lastRetry, setLastRetry] = useState<ApiRequestRecord | null>(null);
  const [lastConflict, setLastConflict] = useState<ApiRequestRecord | null>(null);

  useEffect(() => {
    const loaded = loadRequestHistory();
    const original = loaded.find(
      (record) =>
        record.idempotencyKey &&
        !record.label.startsWith("Retry ") &&
        !record.label.startsWith("Conflict ")
    );

    setHistory(loaded);
    setSelectedId(original?.id ?? loaded.find((record) => record.idempotencyKey)?.id ?? "");
    setLastRetry(loaded.find((record) => record.label.startsWith("Retry ")) ?? null);
    setLastConflict(loaded.find((record) => record.label.startsWith("Conflict ")) ?? null);
  }, []);

  const selected = useMemo(
    () => history.find((record) => record.id === selectedId) ?? history.find((record) => record.idempotencyKey) ?? null,
    [history, selectedId]
  );

  async function retrySameRequest() {
    if (!selected) {
      return;
    }

    const result = await retryRequest(selected);
    setLastRetry(result);
    setHistory(loadRequestHistory());
  }

  async function forceConflict() {
    if (!selected?.idempotencyKey) {
      return;
    }

    const result = await apiFetch(selected.path, {
      method: selected.method,
      body: mutateBody(selected.body),
      idempotencyKey: selected.idempotencyKey,
      label: `Conflict ${selected.label}`
    });
    setLastConflict(result);
    setHistory(loadRequestHistory());
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/">
        Back
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Idempotency</h1>
        <p className="mt-2 text-sm">Retry with the exact same key and body, or reuse the key with a changed body to trigger the 409 conflict path.</p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded border border-slate-300 p-4">
          <h2 className="text-lg font-semibold">Recorded API requests</h2>
          <select
            className="mt-3 w-full rounded border border-slate-300 p-2 text-sm"
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {history.map((record) => (
              <option key={record.id} value={record.id}>
                {record.createdAt} | {record.label} | {record.idempotencyKey ?? "no key"}
              </option>
            ))}
          </select>
          {history.length === 0 ? <p className="mt-3 text-sm">No requests recorded in this browser yet.</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={!selected?.idempotencyKey} type="button" onClick={retrySameRequest}>
              Retry same API request
            </button>
            <button className="rounded border border-slate-400 px-3 py-2 text-sm" disabled={!selected?.idempotencyKey} type="button" onClick={forceConflict}>
              Reuse key with changed body
            </button>
          </div>
        </div>

        <IdempotencyKeyDisplay idempotencyKey={selected?.idempotencyKey} replayed={getReplayFlag(lastRetry)} />
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Visible signals</h2>
        <EventRow label="Scope path" value={selected?.path} />
        <EventRow label="Idempotency-Key" value={selected?.idempotencyKey} />
        <EventRow label="Original HTTP status" value={selected?.status} status={selected?.ok ? "ok" : "error"} />
        <EventRow label="Retry HTTP status" value={lastRetry?.status} status={lastRetry?.ok ? "ok" : "error"} />
        <EventRow label="Conflict HTTP status" value={lastConflict?.status} status={lastConflict?.ok ? "ok" : "error"} />
        <EventRow label="Expected conflict" value="409 Idempotency-Key conflict" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Original</h2>
          <JsonBlock value={selected} />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Retry</h2>
          <JsonBlock value={lastRetry} />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Conflict</h2>
          <JsonBlock value={lastConflict} />
        </div>
      </section>
    </main>
  );
}

function mutateBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      changed: true
    };
  }

  const copy = {
    ...(body as Record<string, unknown>)
  };

  if (typeof copy.amount === "number") {
    copy.amount += 1;
  } else {
    copy.__changed = true;
  }

  return copy;
}

function getReplayFlag(record: ApiRequestRecord | null) {
  const response = record?.response;
  return Boolean(response && typeof response === "object" && (response as Record<string, unknown>).replayed);
}
