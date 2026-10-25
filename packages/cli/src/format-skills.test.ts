import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSkills } from "./format-skills.ts";

test("formatSkills lists each skill with its source, and why one is not used", () => {
  const text = formatSkills(
    [
      { name: "ship", description: "Open a pull request.\nMore.", source: "project", path: "/r/.agents/skills/ship", usable: true },
      { name: "notes", description: "Write notes.", source: "user", path: "/u/notes", usable: true, warnings: ["x"] },
      {
        name: "ship",
        description: "Mine.",
        source: "user",
        path: "/Users/me/.claude/skills/ship",
        usable: false,
        shadowed_by: "/Users/me/r/.agents/skills/ship",
      },
      { name: "broken", description: "", source: "user", path: "/u/broken", usable: false, errors: ["bad YAML", "no description"] },
      { name: "pdf", description: "PDF.", source: "bundled", path: "/b/pdf", usable: false, disabled: true },
    ],
    "/Users/me",
  );
  assert.equal(
    text,
    [
      "✔ ship    project  Open a pull request.",
      "! notes   user     Write notes.",
      "– ship    user     hidden by ~/r/.agents/skills/ship",
      "✘ broken  user     broken: bad YAML (+1 more)",
      "– pdf     bundled  disabled in config.toml",
    ].join("\n"),
  );
});

test("formatSkills says where to put a skill when there is none", () => {
  assert.match(formatSkills([], "/Users/me"), /^no skills here\. Add one as ~\/\.golem\/skills/);
});

test("formatSkills cuts rows to the terminal width", () => {
  const skill = { name: "ship", description: "x".repeat(200), source: "user", path: "/u/ship", usable: true } as const;
  const row = formatSkills([skill], "/Users/me", 40);
  assert.equal(row.length, 40);
  assert.ok(row.endsWith("…"));
});
