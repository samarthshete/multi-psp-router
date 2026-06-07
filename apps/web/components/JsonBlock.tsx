export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded border border-slate-300 bg-slate-50 p-3 text-xs">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}
