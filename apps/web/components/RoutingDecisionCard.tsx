import { ProviderBadge } from "./ProviderBadge";

export function RoutingDecisionCard({
  provider,
  reason,
  paymentOrderId,
  externalRef
}: {
  provider?: string;
  reason?: string;
  paymentOrderId?: string;
  externalRef?: string;
}) {
  return (
    <section className="rounded border border-slate-300 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Routing decision</h2>
        <ProviderBadge provider={provider} />
      </div>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="font-medium">Reason</dt>
          <dd>{reason ?? "USD routes to Stripe, EUR routes to Adyen, override wins."}</dd>
        </div>
        <div>
          <dt className="font-medium">Payment order</dt>
          <dd className="break-all">{paymentOrderId ?? "None yet"}</dd>
        </div>
        <div>
          <dt className="font-medium">PSP reference</dt>
          <dd className="break-all">{externalRef ?? "None yet"}</dd>
        </div>
      </dl>
    </section>
  );
}
