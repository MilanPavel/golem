import { isSecretShape, timingSafeEqual } from "./secret.ts";
import type { SessionStore } from "./sessions.ts";

export type Check =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 405 | 413 | 415; reason: string };

export const MAX_EXCHANGE_BYTES = 4096;
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function cookieName(port: number): string {
  return `golem_${port}`;
}

/** No `Secure`: the page is plain http on 127.0.0.1, and browsers drop a Secure cookie there. */
export function sessionCookie(port: number, secret: string): string {
  return `${cookieName(port)}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function readCookie(headers: Headers, port: number): string | null {
  const header = headers.get("cookie");
  if (header === null) return null;
  const name = cookieName(port);
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

const refuse = (status: 400 | 401 | 403 | 405 | 413 | 415, reason: string): Check => ({ ok: false, status, reason });

export function checkRequest(req: Request, port: number, opts: { requireOrigin: boolean }): Check {
  if (req.headers.get("host") !== `127.0.0.1:${port}`) return refuse(403, "bad host");
  const origin = req.headers.get("origin");
  if (origin === null) {
    if (opts.requireOrigin) return refuse(403, "origin required");
  } else if (origin !== `http://127.0.0.1:${port}`) {
    return refuse(403, "bad origin");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return refuse(403, "bad fetch site");
  return { ok: true };
}

export function checkUpgrade(req: Request, port: number, sessions: SessionStore): Check {
  const checked = checkRequest(req, port, { requireOrigin: true });
  if (!checked.ok) return checked;
  const secret = readCookie(req.headers, port);
  if (secret === null || !sessions.valid(secret)) return refuse(401, "not logged in");
  return { ok: true };
}

function refusal(check: Extract<Check, { ok: false }>): Response {
  return new Response(check.reason, {
    status: check.status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Reads at most `cap` bytes; null when the body is longer. */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function isJson(contentType: string | null): boolean {
  if (contentType === null) return false;
  const [type, ...params] = contentType.split(";").map((s) => s.trim().toLowerCase());
  if (type !== "application/json") return false;
  return params.every((p) => p === "charset=utf-8");
}

/** `POST /auth/exchange`: trades the file token for a session cookie. */
export async function exchangeToken(
  req: Request,
  port: number,
  token: string,
  sessions: SessionStore,
): Promise<Response> {
  // The gateway's own token must look like one it made, or an empty file would let in an empty token.
  if (!isSecretShape(token)) throw new Error("the gateway's login token is malformed");
  if (req.method !== "POST") return refusal({ ok: false, status: 405, reason: "method not allowed" });
  const checked = checkRequest(req, port, { requireOrigin: true });
  if (!checked.ok) return refusal(checked);
  if (!isJson(req.headers.get("content-type"))) {
    return refusal({ ok: false, status: 415, reason: "content type must be application/json" });
  }
  const raw = await readCapped(req.body, MAX_EXCHANGE_BYTES);
  if (raw === null) return refusal({ ok: false, status: 413, reason: "body too large" });
  let sent: unknown;
  try {
    sent = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return refusal({ ok: false, status: 400, reason: "body is not JSON" });
  }
  const value =
    typeof sent === "object" && sent !== null && !Array.isArray(sent)
      ? (sent as Record<string, unknown>)["token"]
      : undefined;
  if (typeof value !== "string") return refusal({ ok: false, status: 400, reason: "token must be a string" });
  if (!timingSafeEqual(value, token)) return refusal({ ok: false, status: 403, reason: "bad token" });
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": sessionCookie(port, sessions.mint()), "Cache-Control": "no-store" },
  });
}
