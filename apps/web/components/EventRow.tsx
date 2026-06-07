export function EventRow({
  label,
  value,
  status
}: {
  label: string;
  value?: string | number | boolean | null;
  status?: string;
}) {
  return (
    <div className="grid gap-1 border-b border-slate-200 py-3 text-sm last:border-b-0 md:grid-cols-[180px_1fr_120px]">
      <div className="font-medium">{label}</div>
      <div className="break-all">{String(value ?? "none")}</div>
      <div>{status ?? ""}</div>
    </div>
  );
}
