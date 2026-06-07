import { ulid } from "ulid";

export type Provider = "STRIPE" | "ADYEN";

export type ApiRequestRecord = {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  idempotencyKey?: string;
  body?: unknown;
  status?: number;
  ok?: boolean;
  response?: unknown;
  error?: string;
  createdAt: string;
};

export type AuthHoldRequest = {
  amount: number;
  currency: string;
  paymentMethodId: string;
  customerId?: string;
  providerOverride?: Provider;
  metadata?: Record<string, unknown>;
};

export type CaptureRequest = {
  amount?: number;
  metadata?: Record<string, unknown>;
};

export type StartSubscriptionRequest = {
  amount: number;
  currency: string;
  paymentMethodId: string;
  customerId?: string;
  email?: string;
  providerCustomerId?: string;
  cadence?: string;
  providerOverride?: Provider;
  metadata?: Record<string, unknown>;
};

export type RenewSubscriptionRequest = {
  amount?: number;
  metadata?: Record<string, unknown>;
};

const HISTORY_KEY = "multi-psp-router:requests";

export function newIdempotencyKey() {
  return ulid();
}

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    idempotencyKey?: string;
    label?: string;
  } = {}
): Promise<ApiRequestRecord & { response?: T }> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const record: ApiRequestRecord = {
    id: ulid(),
    label: options.label ?? `${method} ${path}`,
    method,
    path,
    idempotencyKey: options.idempotencyKey,
    body: options.body,
    createdAt: new Date().toISOString()
  };

  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await readPayload(response);
    const completed = {
      ...record,
      status: response.status,
      ok: response.ok,
      response: payload
    };

    saveRequestRecord(completed);
    return completed as ApiRequestRecord & { response?: T };
  } catch (error) {
    const failed = {
      ...record,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown request error"
    };

    saveRequestRecord(failed);
    return failed as ApiRequestRecord & { response?: T };
  }
}

export function createAuthHold(body: AuthHoldRequest, idempotencyKey = ulid()) {
  return apiFetch<{
    paymentOrderId: string;
    provider: Provider;
    status: string;
    externalRef: string;
    replayed: boolean;
  }>("/payments/auth-hold", {
    method: "POST",
    body,
    idempotencyKey,
    label: "Create auth hold"
  });
}

export function capturePayment(
  paymentOrderId: string,
  body: CaptureRequest,
  idempotencyKey = ulid()
) {
  return apiFetch<{
    paymentOrderId: string;
    captureId: string;
    provider: Provider;
    status: string;
    externalRef: string;
    replayed: boolean;
  }>(`/payments/${encodeURIComponent(paymentOrderId)}/capture`, {
    method: "POST",
    body,
    idempotencyKey,
    label: "Capture payment"
  });
}

export function startSubscription(
  body: StartSubscriptionRequest,
  idempotencyKey = ulid()
) {
  return apiFetch<{
    subscriptionId: string;
    subscriptionChargeId: string;
    paymentMethodTokenId: string;
    provider: Provider;
    status: string;
    externalRef: string;
    replayed: boolean;
  }>("/subscriptions/start", {
    method: "POST",
    body,
    idempotencyKey,
    label: "Start subscription"
  });
}

export function renewSubscription(
  subscriptionId: string,
  body: RenewSubscriptionRequest,
  idempotencyKey = ulid()
) {
  return apiFetch<{
    subscriptionId: string;
    subscriptionChargeId: string;
    provider: Provider;
    status: string;
    externalRef: string;
    replayed: boolean;
  }>(`/subscriptions/${encodeURIComponent(subscriptionId)}/renew`, {
    method: "POST",
    body,
    idempotencyKey,
    label: "Renew subscription"
  });
}

export function replayWebhook(rawWebhookEventId: string) {
  return apiFetch("/dev/replay-webhook", {
    method: "POST",
    body: {
      rawWebhookEventId
    },
    label: "Replay webhook"
  });
}

export function processWebhookJobs() {
  return apiFetch("/dev/process-webhook-jobs", {
    method: "POST",
    label: "Process webhook jobs"
  });
}

export function retryRequest(record: ApiRequestRecord) {
  return apiFetch(record.path, {
    method: record.method,
    body: record.body,
    idempotencyKey: record.idempotencyKey,
    label: `Retry ${record.label}`
  });
}

export function loadRequestHistory(): ApiRequestRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const value = window.localStorage.getItem(HISTORY_KEY);
    return value ? (JSON.parse(value) as ApiRequestRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveRequestRecord(record: ApiRequestRecord) {
  if (typeof window === "undefined") {
    return;
  }

  const history = [record, ...loadRequestHistory()].slice(0, 30);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

async function readPayload(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
