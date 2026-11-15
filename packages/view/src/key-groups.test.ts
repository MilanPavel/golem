import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthKeyStatus } from "@golem/client";

import { keyGroups, mcpRefParts, savedCount } from "./key-groups.ts";

const status = (provider: string, source: AuthKeyStatus["source"], env_var: string | null = null, takes_key = true): AuthKeyStatus => ({
  provider,
  takes_key,
  needs_key: takes_key,
  source,
  env_var,
});

const SERVERS = [{ name: "github", title: "GitHub" }, { name: "brave-search", title: "Brave Search" }, { name: "brave" }, { name: "acme" }];

test("a ref belongs to the longest listed server name", () => {
  assert.deepEqual(mcpRefParts("mcp/brave-search", SERVERS), { server: "brave-search", known: true, input: "", oauth: false });
  assert.deepEqual(mcpRefParts("mcp/github-oauth", SERVERS), { server: "github", known: true, input: "", oauth: true });
  assert.deepEqual(mcpRefParts("mcp/acme-api_key", SERVERS), { server: "acme", known: true, input: "api_key", oauth: false });
  assert.deepEqual(mcpRefParts("mcp/brave-search-region", SERVERS), { server: "brave-search", known: true, input: "region", oauth: false });
});

test("a ref no server claims is its own server, and is not known", () => {
  assert.deepEqual(mcpRefParts("mcp/linear-oauth", []), { server: "linear", known: false, input: "", oauth: true });
});

test("model providers and MCP refs are two groups; keyless providers are left out", () => {
  const groups = keyGroups(
    [status("anthropic", null), status("ollama", null, null, false), status("mcp/github", "keychain"), status("together", "env", "TOGETHER_API_KEY")],
    SERVERS,
  );
  assert.deepEqual(groups.models.map((item) => item.ref), ["together", "anthropic"]);
  assert.deepEqual(groups.mcp.map((item) => item.ref), ["mcp/github"]);
});

test("saved rows come first, then A to Z by display name", () => {
  const groups = keyGroups(
    [status("xai", null), status("openai", "keychain"), status("anthropic", null), status("google", "env", "GEMINI_API_KEY"), status("zeta", "keychain")],
    [],
  );
  assert.deepEqual(groups.models.map((item) => item.name), ["Google", "OpenAI", "zeta", "Anthropic", "xAI"]);
});

test("a hosted provider shows its name and blurb, a custom one its id", () => {
  const rows = keyGroups([status("anthropic", null), status("together", null)], []).models;
  const byRef = new Map(rows.map((item) => [item.ref, item]));
  assert.equal(byRef.get("anthropic")?.name, "Anthropic");
  assert.equal(byRef.get("anthropic")?.blurb, "Claude");
  assert.equal(byRef.get("together")?.name, "together");
  assert.equal(byRef.get("together")?.blurb, "custom · OpenAI-compatible");
});

test("an MCP row has the server title and a blurb of token, input or OAuth", () => {
  const rows = keyGroups([status("mcp/github", null), status("mcp/acme-api_key", null), status("mcp/github-oauth", null)], SERVERS).mcp;
  const byRef = new Map(rows.map((item) => [item.ref, item]));
  assert.equal(byRef.get("mcp/github")?.name, "GitHub");
  assert.equal(byRef.get("mcp/github")?.blurb, "token");
  assert.equal(byRef.get("mcp/acme-api_key")?.name, "acme");
  assert.equal(byRef.get("mcp/acme-api_key")?.blurb, "api_key input");
  assert.equal(byRef.get("mcp/github-oauth")?.blurb, "OAuth sign-in");
});

test("an OAuth ref is set with mcp login, any other with auth set", () => {
  const rows = keyGroups([status("mcp/github-oauth", null), status("mcp/brave-search", null)], SERVERS).mcp;
  const byRef = new Map(rows.map((item) => [item.ref, item]));
  assert.equal(byRef.get("mcp/github-oauth")?.setCommand, "golem mcp login github");
  assert.equal(byRef.get("mcp/brave-search")?.setCommand, "golem auth set mcp/brave-search");
});

test("only a Keychain key can be removed by command", () => {
  const rows = keyGroups([status("openai", "keychain"), status("google", "env", "GEMINI_API_KEY"), status("xai", null)], []).models;
  const byRef = new Map(rows.map((item) => [item.ref, item]));
  assert.equal(byRef.get("openai")?.removeCommand, "golem auth remove openai");
  assert.equal(byRef.get("google")?.removeCommand, null);
  assert.equal(byRef.get("google")?.envVar, "GEMINI_API_KEY");
  assert.equal(byRef.get("xai")?.removeCommand, null);
});

test("savedCount counts the saved rows", () => {
  const { models } = keyGroups([status("openai", "keychain"), status("xai", null)], []);
  assert.deepEqual(savedCount(models), { saved: 1, total: 2 });
  assert.deepEqual(savedCount([]), { saved: 0, total: 0 });
});
