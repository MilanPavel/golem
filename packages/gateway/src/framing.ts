import { BROWSER_METHODS } from "../../protocol/gen/browser-methods.ts";

// The daemon reads lines with a StreamReader whose limit is MAX_LINE_BYTES
// (1_048_576, golem/server/framing.py). readuntil accepts a line when the
// newline sits at index <= limit, so the text may be exactly that long and the
// "\n" the gateway appends comes on top. Checked against asyncio at both edges.
export const MAX_MESSAGE_BYTES = 1_048_576;

/** JSON-RPC error code for a method the browser may not call (ADR-028). */
export const NOT_ALLOWED_FROM_BROWSER = -32020;

export type Refusal = "binary" | "too-large" | "line-break" | "not-json" | "not-object" | "no-method";

export type FilterResult =
  | { kind: "forward"; line: string }
  | { kind: "deny"; reply: string | null }
  | { kind: "refuse"; reason: Refusal };

const encoder = new TextEncoder();

/** Decide what one WebSocket message may do. Never re-serializes the input. */
export function filterMessage(data: string | ArrayBuffer | Uint8Array): FilterResult {
  if (typeof data !== "string") {
    return { kind: "refuse", reason: "binary" };
  }
  if (encoder.encode(data).byteLength > MAX_MESSAGE_BYTES) {
    return { kind: "refuse", reason: "too-large" };
  }
  if (data.includes("\n") || data.includes("\r")) {
    return { kind: "refuse", reason: "line-break" };
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return { kind: "refuse", reason: "not-json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "refuse", reason: "not-object" };
  }
  const request = value as Record<string, unknown>;
  const method = Object.hasOwn(request, "method") ? request["method"] : undefined;
  if (typeof method !== "string") {
    return { kind: "refuse", reason: "no-method" };
  }
  if (BROWSER_METHODS.has(method)) {
    return { kind: "forward", line: `${data}\n` };
  }
  const id = Object.hasOwn(request, "id") ? request["id"] : undefined;
  if (typeof id === "string" || typeof id === "number" || id === null) {
    return {
      kind: "deny",
      reply: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: NOT_ALLOWED_FROM_BROWSER, message: "not allowed from the browser" },
      }),
    };
  }
  return { kind: "deny", reply: null };
}
