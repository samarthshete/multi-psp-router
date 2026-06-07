"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EventRow } from "../components/EventRow";
import { JsonBlock } from "../components/JsonBlock";
import {
  ApiRequestRecord,
  apiFetch,
  getApiBaseUrl,
  loadRequestHistory
} from "../lib/api";

const links = [
  ["/demo/auth-capture", "Auth and capture"],
  ["/demo/subscription", "Subscription"],
  ["/events", "Events"],
  ["/idempotency", "Idempotency"],
  ["/payments/latest", "Payment detail"]
];

export default function Home() {
  const [health, setHealth] = useState<ApiRequestRecord | null>(null);
  const [history, setHistory] = useState<ApiRequestRecord[]>([]);

  useEffect(() => {
    setHistory(loadRequestHistory());
  }, []);

  async function checkHealth() {
    const result = await apiFetch("/health", {
      label: "Health check"
    });
    setHealth(result);
    setHistory(loadRequestHistory());
  }

  const latest = history[0];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="border-b border-slate-300 pb-4">
        <p className="text-sm uppercase text-slate-600">multi-psp-router</p>
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm">
          API base: <code>{getApiBaseUrl()}</code>
        </p>
      </header>

      <nav className="grid gap-3 md:grid-cols-5">
        {links.map(([href, label]) => (
          <Link
            className="rounded border border-slate-300 p-3 text-sm underline"
            href={href}
            key={href}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="rounded border border-slate-300 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Health</h2>
          <button
            className="rounded border border-slate-400 px-3 py-2 text-sm"
            onClick={checkHealth}
            type="button"
          >
            GET /health
          </button>
        </div>
        <div className="mt-3">
          <EventRow label="HTTP status" value={health?.status} status={health?.ok ? "ok" : ""} />
          <EventRow label="API response" value={JSON.stringify(health?.response ?? null)} />
        </div>
      </section>

      <section className="rounded border border-slate-300 p-4">
        <h2 className="text-lg font-semibold">Latest visible signal</h2>
        <div className="mt-3">
          <EventRow label="Request" value={latest?.label} />
          <EventRow label="Path" value={latest?.path} status={latest?.ok ? "ok" : "error"} />
          <EventRow label="Idempotency-Key" value={latest?.idempotencyKey} />
          <EventRow label="HTTP status" value={latest?.status} />
        </div>
        <div className="mt-4">
          <JsonBlock value={latest ?? "No dashboard requests recorded yet"} />
        </div>
      </section>
    </main>
  );
}
