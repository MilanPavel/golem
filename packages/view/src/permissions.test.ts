import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LOCKED, isLoosening, ruleChange, type PermissionItem } from "./permissions.ts";

function rule(action: "allow" | "ask" | "deny", extra: Partial<Extract<PermissionItem, { kind: "rule" }>> = {}): PermissionItem {
  return { kind: "rule", action, tool: "shell", match: null, path: null, source: "config.toml rule 2", ignored: null, file: "user", index: 2, ...extra };
}
const ALLOWANCE: PermissionItem = { kind: "allowance", tool: "shell", subject: "git status" };

test("a user rule is updated or removed", () => {
  assert.deepEqual(ruleChange(rule("ask"), "allow"), { kind: "update", target: "user", index: 2, action: "allow" });
  assert.deepEqual(ruleChange(rule("ask"), "delete"), { kind: "remove", target: "user", index: 2 });
  assert.deepEqual(ruleChange(rule("ask", { file: "project" }), "deny"), { kind: "update", target: "project", index: 2, action: "deny" });
});

test("a rule already at the action does nothing", () => {
  assert.deepEqual(ruleChange(rule("deny"), "deny"), { kind: "none" });
});

test("a default rule, or one with no index, is locked", () => {
  assert.deepEqual(ruleChange(rule("allow", { file: "default", index: null }), "deny"), { kind: "notice", text: DEFAULT_LOCKED });
  assert.deepEqual(ruleChange(rule("allow", { index: null }), "delete"), { kind: "notice", text: DEFAULT_LOCKED });
});

test("an allowance is revoked by delete or deny, and other keys explain", () => {
  const revoke = { kind: "revoke", tool: "shell", subject: "git status" };
  assert.deepEqual(ruleChange(ALLOWANCE, "delete"), revoke);
  assert.deepEqual(ruleChange(ALLOWANCE, "deny"), revoke);
  assert.deepEqual(ruleChange(ALLOWANCE, "ask"), { kind: "notice", text: "x revokes what this session allows" });
});

test("isLoosening: allowing a deny or ask rule, or removing one", () => {
  assert.equal(isLoosening(rule("ask"), "allow"), true);
  assert.equal(isLoosening(rule("deny"), "allow"), true);
  assert.equal(isLoosening(rule("deny"), "delete"), true);
  assert.equal(isLoosening(rule("ask"), "delete"), true);
});

test("isLoosening is false for tightening, an allow rule's removal, and allowances", () => {
  assert.equal(isLoosening(rule("allow"), "deny"), false);
  assert.equal(isLoosening(rule("allow"), "ask"), false);
  assert.equal(isLoosening(rule("allow"), "delete"), false);
  assert.equal(isLoosening(rule("allow"), "allow"), false);
  assert.equal(isLoosening(rule("deny"), "ask"), false);
  assert.equal(isLoosening(ALLOWANCE, "delete"), false);
});
