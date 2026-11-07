import assert from "node:assert/strict";
import { test } from "node:test";

import { editForm, updateFromForm } from "./mcp-edit.ts";

test("a command server becomes one line, and a secret stays a reference", () => {
  const form = editForm({
    command: "npx",
    args: ["-y", "@x/server", "/my folder"],
    env: { TOKEN: "keychain:mcp/x-token", MODE: "fast" },
    timeout_seconds: 30,
  });
  assert.equal(form.target, "command");
  assert.equal(form.command, "npx -y @x/server '/my folder'");
  assert.deepEqual(form.env, [
    { key: "TOKEN", value: "", secret: true, ref: "mcp/x-token" },
    { key: "MODE", value: "fast", secret: false, ref: null },
  ]);
  assert.equal(form.timeout, "30");
});

test("a URL server shows its URL", () => {
  const form = editForm({ url: "https://x.example/mcp", headers: { Authorization: "keychain:mcp/x" } });
  assert.equal(form.target, "url");
  assert.equal(form.url, "https://x.example/mcp");
  assert.equal(form.headers[0]?.ref, "mcp/x");
});

test("an untouched form sends the same config and no secret", () => {
  const original = { command: "npx", args: ["-y", "x"], env: { TOKEN: "keychain:mcp/x-token" }, enabled: true as const };
  const out = updateFromForm("x", original, editForm(original));
  assert.ok(!("error" in out));
  assert.deepEqual(out.secrets, {});
  assert.equal(out.config.command, "npx");
  assert.deepEqual(out.config.args, ["-y", "x"]);
  assert.deepEqual(out.config.env, { TOKEN: "keychain:mcp/x-token" });
  assert.equal(out.config.enabled, true);
});

test("typing in a stored secret's field replaces it", () => {
  const original = { command: "x", env: { TOKEN: "keychain:mcp/x-token" } };
  const form = editForm(original);
  form.env[0] = { ...form.env[0]!, value: "new" };
  const out = updateFromForm("x", original, form);
  assert.ok(!("error" in out));
  assert.deepEqual(out.secrets, { "mcp/x-token": "new" });
});

test("a new secret row names its own reference and needs a value", () => {
  const form = editForm({ command: "x" });
  form.env.push({ key: "API_KEY", value: "", secret: true, ref: null });
  assert.deepEqual(updateFromForm("x", { command: "x" }, form), { error: "Type the secret for API_KEY." });
  form.env[0] = { ...form.env[0]!, value: "s" };
  const out = updateFromForm("x", { command: "x" }, form);
  assert.ok(!("error" in out));
  assert.deepEqual(out.secrets, { "mcp/x-api-key": "s" });
  assert.deepEqual(out.config.env, { API_KEY: "keychain:mcp/x-api-key" });
});

test("switching to a URL drops the command", () => {
  const original = { command: "npx", args: ["x"] };
  const form = { ...editForm(original), target: "url" as const, url: "https://x.example/mcp" };
  const out = updateFromForm("x", original, form);
  assert.ok(!("error" in out));
  assert.equal(out.config.url, "https://x.example/mcp");
  assert.equal(out.config.command, undefined);
  assert.equal(out.config.args, undefined);
});

test("bad input says what is wrong", () => {
  const base = editForm({ command: "x" });
  assert.deepEqual(updateFromForm("x", {}, { ...base, command: "" }), { error: "Type a command or an https:// URL." });
  assert.deepEqual(updateFromForm("x", {}, { ...base, timeout: "soon" }), { error: "The timeout is a number of seconds above 0." });
  assert.deepEqual(updateFromForm("x", {}, { ...base, env: [{ key: "1A", value: "", secret: false, ref: null }] }), { error: '"1A" is not a valid variable name.' });
  assert.deepEqual(
    updateFromForm("x", {}, { ...base, env: [{ key: "A", value: "", secret: false, ref: null }, { key: "A", value: "", secret: false, ref: null }] }),
    { error: "A is there twice." },
  );
});

test("tool patterns go one per line", () => {
  const out = updateFromForm("x", { command: "x" }, { ...editForm({ command: "x" }), include: "read_*\n", exclude: "  delete_*  \n\nwrite_*" });
  assert.ok(!("error" in out));
  assert.deepEqual(out.config.tools, { include: ["read_*"], exclude: ["delete_*", "write_*"] });
});
