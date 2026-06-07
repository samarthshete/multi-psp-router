import { createHash } from "node:crypto";

export function hashRequest(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toJSON();
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : toCanonicalJsonValue(item)
    );
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return Object.fromEntries(
    entries.map(([entryKey, entryValue]) => [
      entryKey,
      toCanonicalJsonValue(entryValue)
    ])
  );
}
