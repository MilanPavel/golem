import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTENT_SECURITY_POLICY, withSecurityHeaders } from "./core.ts";

test("the policy is the one in ADR-028", () => {
  assert.equal(
    CONTENT_SECURITY_POLICY,
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
});

test("the four headers are added and the others are kept", async () => {
  const out = withSecurityHeaders(
    new Response("hi", { status: 201, headers: { "Set-Cookie": "a=b", "Cache-Control": "no-store" } }),
  );
  assert.equal(out.status, 201);
  assert.equal(await out.text(), "hi");
  assert.equal(out.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
  assert.equal(out.headers.get("x-content-type-options"), "nosniff");
  assert.equal(out.headers.get("referrer-policy"), "no-referrer");
  assert.equal(out.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(out.headers.get("set-cookie"), "a=b");
  assert.equal(out.headers.get("cache-control"), "no-store");
});

test("a response with immutable headers is handled", () => {
  const out = withSecurityHeaders(Response.redirect("http://127.0.0.1/x", 302));
  assert.equal(out.status, 302);
  assert.equal(out.headers.get("x-content-type-options"), "nosniff");
});
