"use client";

import { useEffect, useRef, useState } from "react";

type AdyenDropInBoxProps = {
  amount: number;
  currency: string;
  onPaymentMethod: (paymentMethodId: string, data: unknown) => void;
};

export function AdyenDropInBox({
  amount,
  currency,
  onPaymentMethod
}: AdyenDropInBoxProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const componentRef = useRef<{ unmount?: () => void } | null>(null);
  const [message, setMessage] = useState("Waiting for Adyen Drop-in");
  const clientKey = process.env.NEXT_PUBLIC_ADYEN_CLIENT_KEY;

  useEffect(() => {
    let cancelled = false;

    async function mountDropIn() {
      if (!mountRef.current || !clientKey) {
        setMessage("Set NEXT_PUBLIC_ADYEN_CLIENT_KEY to mount Drop-in.");
        return;
      }

      try {
        const { AdyenCheckout, Dropin } = await import("@adyen/adyen-web");
        const checkout = await AdyenCheckout({
          environment: "test",
          clientKey,
          amount: {
            value: amount,
            currency
          },
          countryCode: "US",
          showPayButton: true,
          paymentMethodsResponse: {
            paymentMethods: [
              {
                type: "scheme",
                name: "Credit Card"
              }
            ]
          },
          onSubmit: (state: { data?: { paymentMethod?: unknown } }) => {
            const paymentMethod = state.data?.paymentMethod;
            const token =
              getAdyenPaymentMethodToken(paymentMethod) ??
              `adyen_dropin_${Date.now()}`;
            onPaymentMethod(token, paymentMethod ?? state.data ?? {});
            setMessage("Adyen payment method captured from Drop-in.");
          }
        });

        if (cancelled || !mountRef.current) {
          return;
        }

        componentRef.current = new Dropin(checkout).mount(mountRef.current);
        setMessage("Adyen Drop-in mounted.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not mount Adyen Drop-in.");
      }
    }

    void mountDropIn();

    return () => {
      cancelled = true;
      componentRef.current?.unmount?.();
      componentRef.current = null;
    };
  }, [amount, clientKey, currency, onPaymentMethod]);

  return (
    <div className="rounded border border-slate-300 p-3">
      <div ref={mountRef} />
      <p className="mt-2 text-xs text-slate-600">{message}</p>
    </div>
  );
}

function getAdyenPaymentMethodToken(paymentMethod: unknown) {
  if (!paymentMethod || typeof paymentMethod !== "object") {
    return undefined;
  }

  const value = paymentMethod as Record<string, unknown>;
  const encryptedCardNumber = value.encryptedCardNumber;
  const type = value.type;

  if (typeof encryptedCardNumber === "string") {
    return encryptedCardNumber;
  }

  if (typeof type === "string") {
    return `adyen_${type}_${Date.now()}`;
  }

  return undefined;
}
