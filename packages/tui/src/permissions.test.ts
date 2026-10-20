import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigGetResult } from "@golem/client";

import {
  DEFAULT_LOCKED,
  layoutPermissions,
  openPermissions,
  permissionsKeyOf,
  pressPermissions,
  type PermissionsState,
} from "./permissions.ts";

const CONFIG: ConfigGetResult = {
  config_file: "/Users/me/.golem/config.toml",
  default_model: "qwen",
  log_level: "INFO",
  session_titles: true,
  trusted_projects: [],
  rules: [
    {
      tool: "shell",
      match: "git status",
      action: "allow",
      source: "~/.golem/config.toml rule 1",
      file: "user",
      index: 1,
    },
    { tool: "*", action: "allow", source: "~/app/.golem/policy.toml rule 1", ignored: "not trusted", file: "project", index: 1 },
    { tool: "*", action: "ask", source: "built-in default", file: "default", index: null },
  ],
  session_allowed: [{ tool: "shell", subject: "ls" }],
};

function at(selected: number): PermissionsState {
  return { open: true, selected, config: CONFIG };
}

test("the view lists rules in order, then this session's allowances", () => {
  const lines = layoutPermissions(at(0), 100, 10);
  assert.ok(lines[0]?.text.startsWith("Permissions  ↑↓ move"));
  assert.deepEqual(
    lines.slice(1).map((line) => [line.text, line.selected, line.dim]),
    [
      ['  allow  shell match "git status"  ~/.golem/config.toml rule 1', true, false],
      ["  allow  *  ~/app/.golem/policy.toml rule 1, ignored: not trusted", false, true],
      ["  ask    *  built-in default", false, true],
      ["  session  allow  shell ls  (for this session)", false, false],
    ],
  );
  assert.deepEqual(layoutPermissions(openPermissions(), 100, 5)[1]?.text, "loading…");
});

test("keys change, delete, or revoke the selected row, and defaults stay", () => {
  assert.deepEqual(pressPermissions(at(0), "deny").action, { kind: "update", target: "user", index: 1, action: "deny" });
  assert.deepEqual(pressPermissions(at(0), "allow").action, { kind: "none" });
  assert.deepEqual(pressPermissions(at(1), "delete").action, { kind: "remove", target: "project", index: 1 });
  assert.deepEqual(pressPermissions(at(2), "deny").action, { kind: "notice", text: DEFAULT_LOCKED });
  assert.deepEqual(pressPermissions(at(3), "delete").action, { kind: "revoke", tool: "shell", subject: "ls" });
  assert.equal(pressPermissions(at(0), "up").state.selected, 0);
  assert.equal(pressPermissions(at(3), "down").state.selected, 3);
  assert.equal(pressPermissions(at(0), "close").state.open, false);
});

test("keys map from presses", () => {
  const press = (input: string, name: Parameters<typeof permissionsKeyOf>[0]["name"] = null) =>
    permissionsKeyOf({ name, input, ctrl: false, meta: false });
  assert.equal(press("a"), "allow");
  assert.equal(press("k"), "ask");
  assert.equal(press("d"), "deny");
  assert.equal(press("x"), "delete");
  assert.equal(press("", "escape"), "close");
  assert.equal(press("", "down"), "down");
  assert.equal(press("q"), null);
});
