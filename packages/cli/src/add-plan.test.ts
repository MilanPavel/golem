import assert from "node:assert/strict";
import { test } from "node:test";

import { looksSecret, planAdd, type AddInput } from "./add-plan.ts";
import type { AddOptions } from "./mcp-command.ts";

const OPTIONS: AddOptions = { env: [], headers: [], cwd: null, onDemand: false, project: false, timeout: null, approval: null };

function plan(input: AddInput) {
  const made = planAdd(input);
  assert.ok(made.ok, made.ok ? "" : made.message);
  return made.plan;
}

function refused(input: AddInput): string {
  const made = planAdd(input);
  assert.equal(made.ok, false);
  return made.ok ? "" : made.message;
}

test("a plain variable stays in the config, and a secret one goes to the Keychain", () => {
  const made = plan({
    name: "gh",
    command: "npx",
    args: ["-y", "x"],
    tokenEnv: null,
    options: { ...OPTIONS, env: ["REGION=eu", "GITHUB_TOKEN=ghp_x", "OTHER_SECRET"], cwd: "/work", timeout: 30, approval: "allow", onDemand: true },
  });
  assert.deepEqual(made.config, {
    command: "npx",
    args: ["-y", "x"],
    env: { REGION: "eu", GITHUB_TOKEN: "keychain:mcp/gh", OTHER_SECRET: "keychain:mcp/gh-other_secret" },
    cwd: "/work",
    enabled: "on_demand",
    timeout_seconds: 30,
    approval: "allow",
  });
  assert.deepEqual(made.secrets, [
    { ref: "mcp/gh", label: "GITHUB_TOKEN for gh", value: "ghp_x" },
    { ref: "mcp/gh-other_secret", label: "OTHER_SECRET for gh", value: null },
  ]);
  assert.equal(made.scope, "user");
});

test("--token-env and --token take the first secret, and a header named Authorization gets Bearer", () => {
  const command = plan({ name: "x", command: "run", args: [], tokenEnv: "API_TOKEN", options: { ...OPTIONS, env: ["MORE_KEY=v"] } });
  assert.deepEqual(command.config.env, { API_TOKEN: "keychain:mcp/x", MORE_KEY: "keychain:mcp/x-more_key" });
  assert.equal(command.secrets[0]?.value, null);

  const url = plan({ name: "h", url: "https://x.test/mcp", token: true, options: { ...OPTIONS, headers: ["X-Team=blue", "X-API-Key"], project: true } });
  assert.deepEqual(url.config.headers, {
    Authorization: "Bearer keychain:mcp/h",
    "X-Team": "blue",
    "X-API-Key": "keychain:mcp/h-x-api-key",
  });
  assert.equal(url.scope, "project");

  const asked = plan({ name: "a", url: "https://x.test/mcp", token: false, options: { ...OPTIONS, headers: ["Authorization", "X-Other=Bearer abc"] } });
  assert.deepEqual(asked.config.headers, { Authorization: "Bearer keychain:mcp/a", "X-Other": "Bearer keychain:mcp/a-x-other" });
  assert.deepEqual(asked.secrets.map((each) => each.value), [null, "abc"]);
});

test("no options and no secrets is the bare config", () => {
  assert.deepEqual(plan({ name: "g", command: "uvx", args: ["mcp-server-git"], tokenEnv: null }).config, { command: "uvx", args: ["mcp-server-git"] });
  assert.deepEqual(plan({ name: "g", url: "https://x.test/mcp", token: false }).config, { url: "https://x.test/mcp" });
});

test("what does not fit a command or a url, or has no value, is refused", () => {
  assert.match(refused({ name: "x", command: "c", args: [], tokenEnv: null, options: { ...OPTIONS, headers: ["A=b"] } }), /--header is for a url server/);
  assert.match(refused({ name: "x", url: "https://x.test/m", token: false, options: { ...OPTIONS, env: ["A=b"] } }), /--env is for a command/);
  assert.match(refused({ name: "x", url: "https://x.test/m", token: false, options: { ...OPTIONS, cwd: "/w" } }), /--cwd is for a command/);
  assert.match(refused({ name: "x", command: "c", args: [], tokenEnv: null, options: { ...OPTIONS, env: ["REGION"] } }), /REGION needs a value/);
  assert.match(refused({ name: "x", command: "c", args: [], tokenEnv: null, options: { ...OPTIONS, env: ["1BAD=x"] } }), /not a variable name/);
  assert.match(refused({ name: "x", command: "c", args: [], tokenEnv: null, options: { ...OPTIONS, env: ["A=1", "A=2"] } }), /A is given twice/);
  assert.match(refused({ name: "x", url: "https://x.test/m", token: true, options: { ...OPTIONS, headers: ["Authorization=Bearer q"] } }), /Authorization is given twice/);
});

test("a name that ends in token, key, or password looks like a secret, and dashes count as underscores", () => {
  for (const key of ["GITHUB_TOKEN", "api_key", "X-API-Key", "password", "Authorization", "DB_PASSWD"]) assert.ok(looksSecret(key), key);
  for (const key of ["REGION", "KEY_PATH", "TOKENIZER", "X-Team"]) assert.ok(!looksSecret(key), key);
});
