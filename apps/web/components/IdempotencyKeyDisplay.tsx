export function IdempotencyKeyDisplay({
  idempotencyKey,
  replayed
}: {
  idempotencyKey?: string;
  replayed?: boolean;
}) {
  return (
    <div className="rounded border border-slate-300 p-3 text-sm">
      <div className="font-medium">Idempotency-Key</div>
      <code className="mt-1 block break-all text-xs">
        {idempotencyKey ?? "No request sent yet"}
      </code>
      <div className="mt-2 text-xs">Replay: {replayed ? "yes" : "no"}</div>
    </div>
  );
}
