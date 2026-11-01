import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkRequest,
  checkUpgrade,
  createSessionStore,
  exchangeToken,
  randomSecret,
  readCookie,
  sessionCookie,
} from "./core.ts";

const PORT = 7480;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL_ = `http://${HOST}/`;

function req(headers: Record<string, string | null>, init: RequestInit = {}): Request {
  const h = new Headers();
  for (const [k, v] of Object.entries({ host: HOST, ...headers })) if (v !== null) h.set(k, v);
  return new Request(URL_, { ...init, headers: h });
}

function failed(check: ReturnType<typeof checkRequest>, status: number): void {
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.status, status);
}

const upgradeOpts = { requireOrigin: true };

// Origin and Host

test("Origin missing on an upgrade is refused", () => {
  failed(checkRequest(req({}), PORT, upgradeOpts), 403);
});

test("Origin missing on a plain GET is allowed", () => {
  assert.deepEqual(checkRequest(req({}), PORT, { requireOrigin: false }), { ok: true });
});

test("the exact Origin and Host pass", () => {
  assert.deepEqual(checkRequest(req({ origin: ORIGIN }), PORT, upgradeOpts), { ok: true });
});

test("Origin: null is refused", () => {
  failed(checkRequest(req({ origin: "null" }), PORT, { requireOrigin: false }), 403);
});

test("Origin of another port is refused", () => {
  failed(checkRequest(req({ origin: "http://127.0.0.1:7481" }), PORT, upgradeOpts), 403);
});

test("Origin localhost is refused", () => {
  failed(checkRequest(req({ origin: `http://localhost:${PORT}` }), PORT, upgradeOpts), 403);
});

test("Origin with upper-case letters is refused", () => {
  failed(checkRequest(req({ origin: `HTTP://127.0.0.1:${PORT}` }), PORT, upgradeOpts), 403);
});

test("Origin with a trailing slash is refused", () => {
  failed(checkRequest(req({ origin: `${ORIGIN}/` }), PORT, upgradeOpts), 403);
});

test("Host 127.0.0.1.nip.io:7480 is refused", () => {
  failed(checkRequest(req({ host: `127.0.0.1.nip.io:${PORT}`, origin: ORIGIN }), PORT, upgradeOpts), 403);
});

test("Host without the port is refused", () => {
  failed(checkRequest(req({ host: "127.0.0.1", origin: ORIGIN }), PORT, upgradeOpts), 403);
});

test("Host localhost:7480 is refused", () => {
  failed(checkRequest(req({ host: `localhost:${PORT}`, origin: ORIGIN }), PORT, upgradeOpts), 403);
});

test("Host with upper case is refused", () => {
  failed(checkRequest(req({ host: `LOCALHOST:${PORT}` }), PORT, { requireOrigin: false }), 403);
});

test("Host missing is refused", () => {
  failed(checkRequest(req({ host: null, origin: ORIGIN }), PORT, upgradeOpts), 403);
});

test("Sec-Fetch-Site cross-site is refused", () => {
  failed(checkRequest(req({ origin: ORIGIN, "sec-fetch-site": "cross-site" }), PORT, upgradeOpts), 403);
});

test("Sec-Fetch-Site same-site is refused", () => {
  failed(checkRequest(req({ origin: ORIGIN, "sec-fetch-site": "same-site" }), PORT, upgradeOpts), 403);
});

test("Sec-Fetch-Site same-origin and none are allowed", () => {
  for (const v of ["same-origin", "none"]) {
    assert.deepEqual(checkRequest(req({ origin: ORIGIN, "sec-fetch-site": v }), PORT, upgradeOpts), { ok: true });
  }
});

// Login on an upgrade

function upgrade(cookie: string | null, extra: Record<string, string | null> = {}): Request {
  return req({ origin: ORIGIN, cookie, ...extra });
}

test("an upgrade with no cookie is refused with 401", () => {
  failed(checkUpgrade(upgrade(null), PORT, createSessionStore()), 401);
});

test("an upgrade with a wrong cookie is refused with 401", () => {
  const s = createSessionStore();
  s.mint();
  failed(checkUpgrade(upgrade(`golem_${PORT}=wrong`), PORT, s), 401);
});

test("a cookie named for another port is refused", () => {
  const s = createSessionStore();
  const secret = s.mint();
  failed(checkUpgrade(upgrade(`golem_7481=${secret}`), PORT, s), 401);
});

test("a secret from before a restart is refused", () => {
  const secret = createSessionStore().mint();
  failed(checkUpgrade(upgrade(`golem_${PORT}=${secret}`), PORT, createSessionStore()), 401);
});

test("the file token sent as the cookie is refused", () => {
  const s = createSessionStore();
  s.mint();
  failed(checkUpgrade(upgrade(`golem_${PORT}=file-token`), PORT, s), 401);
});

test("a valid cookie passes", () => {
  const s = createSessionStore();
  const secret = s.mint();
  assert.deepEqual(checkUpgrade(upgrade(`other=1; golem_${PORT}=${secret}; x=y`), PORT, s), { ok: true });
});

test("an expired secret is refused", () => {
  let t = 0;
  const s = createSessionStore({ now: () => t, maxAgeMs: 1000 });
  const secret = s.mint();
  t = 1001;
  failed(checkUpgrade(upgrade(`golem_${PORT}=${secret}`), PORT, s), 401);
});

test("a valid cookie with a bad Origin is still refused", () => {
  const s = createSessionStore();
  const secret = s.mint();
  failed(checkUpgrade(upgrade(`golem_${PORT}=${secret}`, { origin: "http://evil.example" }), PORT, s), 403);
  failed(checkUpgrade(upgrade(`golem_${PORT}=${secret}`, { origin: null }), PORT, s), 403);
});

test("readCookie reads exactly golem_<port>", () => {
  const h = new Headers({ cookie: "xgolem_7480=a; golem_7480x=b; golem_7480=c" });
  assert.equal(readCookie(h, PORT), "c");
  assert.equal(readCookie(new Headers(), PORT), null);
});

// Exchange

const TOKEN = randomSecret();

function post(body: BodyInit | null, headers: Record<string, string | null> = {}, method = "POST"): Request {
  return req(
    { origin: ORIGIN, "content-type": "application/json", ...headers },
    { method, ...(body === null ? {} : { body }) },
  );
}

async function refused(res: Response, status: number): Promise<void> {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok((await res.text()).length > 0);
}

test("exchange: a wrong token is 403 with no cookie", async () => {
  await refused(await exchangeToken(post(JSON.stringify({ token: "bad" })), PORT, TOKEN, createSessionStore()), 403);
});

test("exchange: GET is 405", async () => {
  await refused(await exchangeToken(post(null, {}, "GET"), PORT, TOKEN, createSessionStore()), 405);
});

test("exchange: missing Origin is 403", async () => {
  const r = post(JSON.stringify({ token: TOKEN }), { origin: null });
  await refused(await exchangeToken(r, PORT, TOKEN, createSessionStore()), 403);
});

test("exchange: wrong Host is 403", async () => {
  const r = post(JSON.stringify({ token: TOKEN }), { host: "localhost:7480" });
  await refused(await exchangeToken(r, PORT, TOKEN, createSessionStore()), 403);
});

test("exchange: wrong Content-Type is 415", async () => {
  const r = post(JSON.stringify({ token: TOKEN }), { "content-type": "text/plain" });
  await refused(await exchangeToken(r, PORT, TOKEN, createSessionStore()), 415);
  const none = post(JSON.stringify({ token: TOKEN }), { "content-type": null });
  // A string body makes fetch add text/plain, which is also refused.
  await refused(await exchangeToken(none, PORT, TOKEN, createSessionStore()), 415);
});

test("exchange: a body over 4 KiB is 413", async () => {
  const big = JSON.stringify({ token: "x".repeat(5000) });
  await refused(await exchangeToken(post(big), PORT, TOKEN, createSessionStore()), 413);
});

test("exchange: a lying small Content-Length does not hide a big body", async () => {
  const big = JSON.stringify({ token: "x".repeat(5000) });
  const r = post(big, { "content-length": "20" });
  const res = await exchangeToken(r, PORT, TOKEN, createSessionStore());
  await refused(res, 413);
});

test("exchange: a streamed body over 4 KiB is 413", async () => {
  const chunk = new TextEncoder().encode("x".repeat(1024));
  let n = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (n++ < 10) c.enqueue(chunk);
      else c.close();
    },
  });
  const r = req(
    { origin: ORIGIN, "content-type": "application/json" },
    { method: "POST", body, duplex: "half" } as RequestInit,
  );
  await refused(await exchangeToken(r, PORT, TOKEN, createSessionStore()), 413);
});

test("exchange: exactly 4 KiB is not too large", async () => {
  const pad = "x".repeat(4096 - JSON.stringify({ token: "" }).length);
  await refused(await exchangeToken(post(JSON.stringify({ token: pad })), PORT, TOKEN, createSessionStore()), 403);
});

test("exchange: a body that is not JSON is 400", async () => {
  await refused(await exchangeToken(post("{nope"), PORT, TOKEN, createSessionStore()), 400);
  await refused(await exchangeToken(post(""), PORT, TOKEN, createSessionStore()), 400);
});

test("exchange: no token is 400", async () => {
  await refused(await exchangeToken(post("{}"), PORT, TOKEN, createSessionStore()), 400);
  await refused(await exchangeToken(post("[]"), PORT, TOKEN, createSessionStore()), 400);
  await refused(await exchangeToken(post("null"), PORT, TOKEN, createSessionStore()), 400);
});

test("exchange: a token that is not a string is 400", async () => {
  await refused(await exchangeToken(post('{"token":123}'), PORT, TOKEN, createSessionStore()), 400);
  await refused(await exchangeToken(post('{"token":null}'), PORT, TOKEN, createSessionStore()), 400);
});

test("exchange: the right token is 204 with a session cookie", async () => {
  const s = createSessionStore();
  const res = await exchangeToken(post(JSON.stringify({ token: TOKEN })), PORT, TOKEN, s);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /^golem_7480=([A-Za-z0-9_-]+); HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/.exec(cookie);
  assert.ok(m, cookie);
  const secret = m[1] ?? "";
  assert.notEqual(secret, TOKEN);
  assert.equal(cookie, sessionCookie(PORT, secret));
  assert.deepEqual(checkUpgrade(upgrade(`golem_${PORT}=${secret}`), PORT, s), { ok: true });
  failed(checkUpgrade(upgrade(`golem_${PORT}=${TOKEN}`), PORT, s), 401);
});

test("exchange: charset on the Content-Type is allowed", async () => {
  const r = post(JSON.stringify({ token: TOKEN }), { "content-type": "application/json; charset=utf-8" });
  assert.equal((await exchangeToken(r, PORT, TOKEN, createSessionStore())).status, 204);
});

test("exchange: an empty token on the gateway never lets an empty token in", async () => {
  const sessions = createSessionStore();
  const request = new Request(URL_ + "auth/exchange", {
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ token: "" }),
  });
  await assert.rejects(exchangeToken(request, PORT, "", sessions), /malformed/);
});
