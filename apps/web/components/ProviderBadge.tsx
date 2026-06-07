import type { Provider } from "../lib/api";

export function ProviderBadge({ provider }: { provider?: Provider | string }) {
  const label = provider ?? "UNKNOWN";

  return (
    <span className="inline-flex items-center rounded border border-slate-300 px-2 py-1 text-xs font-medium uppercase">
      {label}
    </span>
  );
}
