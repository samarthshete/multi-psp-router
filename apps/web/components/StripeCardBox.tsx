"use client";

import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";

type StripeCardBoxProps = {
  onPaymentMethod: (paymentMethodId: string) => void;
};

export function StripeCardBox({ onPaymentMethod }: StripeCardBoxProps) {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );

  if (!stripePromise) {
    return (
      <div className="rounded border border-slate-300 p-3 text-sm">
        Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to mount Stripe Elements.
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <StripeCardForm onPaymentMethod={onPaymentMethod} />
    </Elements>
  );
}

function StripeCardForm({ onPaymentMethod }: StripeCardBoxProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState("Enter a test card, then create a PaymentMethod.");

  async function createPaymentMethod() {
    const card = elements?.getElement(CardElement);

    if (!stripe || !card) {
      setMessage("Stripe Elements is not ready.");
      return;
    }

    const result = await stripe.createPaymentMethod({
      type: "card",
      card
    });

    if (result.error || !result.paymentMethod) {
      setMessage(result.error?.message ?? "Stripe did not return a PaymentMethod.");
      return;
    }

    onPaymentMethod(result.paymentMethod.id);
    setMessage(`PaymentMethod ready: ${result.paymentMethod.id}`);
  }

  return (
    <div className="rounded border border-slate-300 p-3">
      <div className="rounded border border-slate-300 p-3">
        <CardElement />
      </div>
      <button
        className="mt-3 rounded border border-slate-400 px-3 py-2 text-sm"
        type="button"
        onClick={createPaymentMethod}
      >
        Create Stripe PaymentMethod
      </button>
      <p className="mt-2 text-xs text-slate-600">{message}</p>
    </div>
  );
}
