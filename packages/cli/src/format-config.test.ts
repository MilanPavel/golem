import assert from "node:assert/strict";
import { test } from "node:test";

import { formatConfig } from "./format-config.ts";

test("formatConfig lists settings, then the rules in check order", () => {
  const text = formatConfig({
    config_file: "/Users/me/.golem/config.toml",
    default_model: "qwen",
    log_level: "INFO",
    session_titles: true,
    trusted_projects: [],
    project_policy: "/Users/me/app/.golem/policy.toml",
    project_trusted: false,
    rules: [
      {
        tool: "*",
        match: null,
        path: null,
        action: "allow",
        source: "~/app/.golem/policy.toml rule 1",
        ignored: "the project is not in trusted_projects",
      },
      { tool: "grep", match: "*secret*", path: null, action: "deny", source: "~/.golem/config.toml rule 1" },
      { tool: "read_file", action: "allow", source: "built-in default" },
      { tool: "*", action: "ask", source: "built-in default" },
    ],
  });
  assert.equal(
    text,
    [
      "config file      /Users/me/.golem/config.toml",
      "default model    qwen",
      "log level        INFO",
      "session titles   on",
      "trusted projects none",
      "project policy   /Users/me/app/.golem/policy.toml (not trusted, its allow rules are ignored)",
      "",
      "tool rules, first match wins:",
      "  1  allow  *                      ~/app/.golem/policy.toml rule 1, ignored: the project is not in trusted_projects",
      "  2  deny   grep match \"*secret*\"  ~/.golem/config.toml rule 1",
      "  3  allow  read_file              built-in default",
      "  4  ask    *                      built-in default",
    ].join("\n"),
  );
});
