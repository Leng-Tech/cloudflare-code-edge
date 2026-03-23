import type { LinearLabel, LinearWebhookPayload } from "../types.js";

export const AI_READY_LABEL = "ai-ready";
export const LINEAR_SIGNATURE_HEADER = "linear-signature";
const DEFAULT_MAX_WEBHOOK_AGE_MS = 60_000;

interface VerifyLinearWebhookOptions {
  maxAgeMs?: number;
  nowMs?: number;
  webhookTimestamp?: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array | null {
  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    const byte = Number.parseInt(normalized.slice(index, index + 2), 16);

    if (Number.isNaN(byte)) {
      return null;
    }

    bytes[index / 2] = byte;
  }

  return bytes;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}

async function computeHmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  return bytesToHex(new Uint8Array(signature));
}

export async function verifyLinearWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  options: VerifyLinearWebhookOptions = {},
): Promise<boolean> {
  if (!signatureHeader) {
    return false;
  }

  if (typeof options.webhookTimestamp === "number") {
    const nowMs = options.nowMs ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_WEBHOOK_AGE_MS;
    const ageMs = Math.abs(nowMs - options.webhookTimestamp);

    if (ageMs > maxAgeMs) {
      return false;
    }
  }

  const expected = await computeHmacSha256Hex(secret, payload);
  const providedBytes = hexToBytes(signatureHeader);
  const expectedBytes = hexToBytes(expected);

  if (!providedBytes || !expectedBytes) {
    return false;
  }

  return timingSafeEqual(providedBytes, expectedBytes);
}

function isLinearLabel(value: unknown): value is LinearLabel {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "name" in value &&
      typeof value.name === "string",
  );
}

export function getLinearLabels(payload: LinearWebhookPayload): LinearLabel[] {
  const { data } = payload;

  if (!data || typeof data !== "object" || !("labels" in data)) {
    return [];
  }

  const { labels } = data as { labels?: unknown };

  if (Array.isArray(labels)) {
    return labels.filter(isLinearLabel);
  }

  if (
    labels &&
    typeof labels === "object" &&
    "nodes" in labels &&
    Array.isArray(labels.nodes)
  ) {
    return labels.nodes.filter(isLinearLabel);
  }

  return [];
}

export function hasLinearLabel(
  payload: LinearWebhookPayload,
  expectedLabel: string,
): boolean {
  const normalizedExpected = expectedLabel.trim().toLowerCase();

  return getLinearLabels(payload).some(
    (label) => label.name.trim().toLowerCase() === normalizedExpected,
  );
}

export function isAiReadyIssue(payload: LinearWebhookPayload): boolean {
  return hasLinearLabel(payload, AI_READY_LABEL);
}

export function isLinearIssuePayload(
  payload: unknown,
): payload is LinearWebhookPayload {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return false;
  }

  const candidate = payload.data;

  return Boolean(
    candidate &&
      typeof candidate === "object" &&
      "id" in candidate &&
      typeof candidate.id === "string" &&
      "title" in candidate &&
      typeof candidate.title === "string",
  );
}
