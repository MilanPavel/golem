import assert from "node:assert/strict";
import { test } from "node:test";

import { agoText, isRefused, signInLine, tokenTestRows } from "./mcp-signin.ts";

const base = { oauth: false, state: "running" as const, secrets: [{ ref: "mcp/github", stored: true }], refused: false, workedAt: null, now: 1_000_000 };

test("a token that is there says where it is and when it worked", () => {
  const line = signInLine({ ...base, workedAt: base.now - 120_000 });
  assert.deepEqual(line, { tone: "ok", label: "Token", ref: "mcp/github", worked: "worked 2 min ago", action: { kind: "replace", label: "Replace" } });
});

test("a missing token is asked for, and a refused one is replaced", () => {
  assert.equal(signInLine({ ...base, secrets: [{ ref: "mcp/github", stored: false }] })?.action.label, "Add it");
  const refused = signInLine({ ...base, refused: true });
  assert.equal(refused?.label, "Token refused");
  assert.equal(refused?.tone, "bad");
});

test("OAuth is signed in or not, and a server with no secret has no line", () => {
  assert.equal(signInLine({ ...base, oauth: true })?.action.label, "Sign out");
  assert.equal(signInLine({ ...base, oauth: true, state: "needs_auth" })?.action.label, "Sign in");
  assert.equal(signInLine({ ...base, secrets: [] }), null);
});

test("401 and 403 are a refusal, from the status or from the error", () => {
  assert.ok(isRefused(401, null));
  assert.ok(isRefused(403, null));
  assert.ok(isRefused(null, "HTTP 401: nope"));
  assert.ok(!isRefused(500, "HTTP 500"));
  assert.ok(!isRefused(null, null));
});

test("ages are short words", () => {
  assert.equal(agoText(10_000), "just now");
  assert.equal(agoText(3 * 3_600_000), "3 h ago");
  assert.equal(agoText(86_400_000), "1 day ago");
});

test("the test steps read as ready, connected, signed in, listed", () => {
  const rows = tokenTestRows(
    [
      { step: "resolve", state: "ok" },
      { step: "connect", state: "ok" },
      { step: "initialize", state: "ok" },
      { step: "tools", state: "ok", detail: "46 tools" },
    ],
    "api.example.com",
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["Token ready for the test", "Connected to api.example.com", "Signed in", "Listed 46 tools"],
  );
});
