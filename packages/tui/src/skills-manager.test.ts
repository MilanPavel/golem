import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedSkill } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  closedSkillsManager,
  layoutSkillsManager,
  openSkillsManager,
  pressSkillsManager,
  SKILLS_HINT,
  skillsManagerKeyOf,
  type SkillsManagerKey,
  type SkillsManagerState,
} from "./skills-manager.ts";

const HOME = "/Users/me";
const CWD = "/Users/me/repo";
const ship: ListedSkill = {
  name: "ship",
  description: "Take the local changes to an open pull request.",
  source: "project",
  path: "/Users/me/repo/.agents/skills/ship",
  usable: true,
  argument_hint: "[hint]",
  model_invocable: false,
  allowed_tools: ["Bash(git *)", "Read"],
};
const notes: ListedSkill = {
  name: "notes",
  description: "Write release notes.",
  source: "user",
  path: "/Users/me/.golem/skills/notes",
  usable: true,
  warnings: ["`context` is not supported yet, so it is ignored"],
};
const myShip: ListedSkill = {
  name: "ship",
  description: "My own ship.",
  source: "user",
  path: "/Users/me/.claude/skills/ship",
  usable: false,
  shadowed_by: "/Users/me/repo/.agents/skills/ship",
};
const broken: ListedSkill = {
  name: "broken",
  description: "",
  source: "user",
  path: "/Users/me/.claude/skills/broken",
  usable: false,
  errors: ["the frontmatter is not valid YAML: line 3: expected ',' or ']'"],
};
const off: ListedSkill = {
  name: "pdf",
  description: "Fill PDF forms.",
  source: "user",
  path: "/Users/me/.golem/skills/pdf",
  usable: false,
  disabled: true,
};
const SKILLS = [ship, notes, myShip, broken, off];

function press(state: SkillsManagerState, ...keys: SkillsManagerKey[]) {
  let current = state;
  let action: ReturnType<typeof pressSkillsManager>["action"] = { kind: "none" };
  for (const key of keys) {
    ({ state: current, action } = pressSkillsManager(current, SKILLS, key));
  }
  return { state: current, action };
}

function shown(state: SkillsManagerState, skills: readonly ListedSkill[] | null = SKILLS, rows = 40): string[] {
  return layoutSkillsManager({ state, skills, error: null, cwd: CWD, home: HOME, columns: 100, rows }).map(
    (line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`,
  );
}

test("keys: arrows, Enter, and Esc", () => {
  const key = (name: Press["name"], input = "") => skillsManagerKeyOf({ name, input, ctrl: false, meta: false });
  assert.equal(key("up"), "up");
  assert.equal(key("return"), "enter");
  assert.equal(key("escape"), "back");
  assert.equal(key(null, "1"), null);
});

test("the list groups the project's skills, then yours, and says why one is not usable", () => {
  assert.deepEqual(shown(openSkillsManager()), [
    "Skills",
    "5 skills · 2 usable",
    "",
    "  This project (~/repo)",
    "❯ ✔ ship    Take the local changes to an open pull request.",
    "",
    "  Yours",
    "  ! notes   Write release notes.",
    "  – ship    hidden by ~/repo/.agents/skills/ship",
    "  ✘ broken  the frontmatter is not valid YAML: line 3: expected ',' or ']'",
    "  – pdf     disabled in config.toml",
    "",
    "↑/↓ to navigate · Enter to open · Esc to close",
  ]);
});

test("no skills says where to put one, and the wait says so", () => {
  assert.deepEqual(shown(openSkillsManager(), []).slice(0, 4), ["Skills", "0 skills", "", SKILLS_HINT]);
  assert.equal(shown(openSkillsManager(), null)[2], "asking the daemon…");
});

test("an error from the daemon is shown in place of the list", () => {
  const lines = layoutSkillsManager({
    state: openSkillsManager(),
    skills: null,
    error: "daemon is not reachable",
    cwd: CWD,
    home: HOME,
    columns: 100,
    rows: 10,
  });
  assert.equal(lines[2]?.text, "daemon is not reachable");
});

test("Enter opens a skill's details", () => {
  const { state } = press(openSkillsManager(), "enter");
  assert.deepEqual(state.view, { kind: "detail", path: ship.path, offset: 0 });
  assert.deepEqual(shown(state), [
    "ship skill",
    "",
    "Status:        ✔ usable",
    "From:          This project",
    "Folder:        ~/repo/.agents/skills/ship",
    "Description:   Take the local changes to an open pull request.",
    "You run it:    /ship [hint]",
    "Model uses it: no, only you",
    "Allowed tools: Bash(git *), Read",
    "",
    "↑/↓ to scroll · Esc to go back",
  ]);
});

test("a broken skill's details list its errors, and a hidden one names the winner", () => {
  const brokenView = press(openSkillsManager(), "down", "down", "down", "enter").state;
  const lines = shown(brokenView);
  assert.equal(lines[2], "Status:        ✘ broken: never used");
  assert.ok(lines.includes("Errors"));
  assert.ok(lines.includes("✘ the frontmatter is not valid YAML: line 3: expected ',' or ']'"));

  const hidden = press(openSkillsManager(), "down", "down", "enter").state;
  assert.equal(shown(hidden)[2], "Status:        – hidden by the skill in ~/repo/.agents/skills/ship");
});

test("Esc goes back to the list on the same skill, then closes", () => {
  const detail = press(openSkillsManager(), "down", "enter").state;
  const back = pressSkillsManager(detail, SKILLS, "back");
  assert.deepEqual(back.state.view, { kind: "list", selected: 1 });
  const closed = pressSkillsManager(back.state, SKILLS, "back");
  assert.deepEqual(closed, { state: closedSkillsManager, action: { kind: "close" } });
});

test("a skill that disappears while open falls back to the list", () => {
  const detail = press(openSkillsManager(), "enter").state;
  assert.equal(shown(detail, [notes])[0], "Skills");
});

test("a long description wraps under its label, and the details scroll", () => {
  const long = { ...notes, description: "word ".repeat(60).trim(), warnings: [] };
  const state: SkillsManagerState = { open: true, view: { kind: "detail", path: long.path, offset: 0 } };
  const lines = layoutSkillsManager({ state, skills: [long], error: null, cwd: CWD, home: HOME, columns: 60, rows: 40 });
  const description = lines.findIndex((line) => line.text.startsWith("Description:"));
  assert.ok(lines[description + 1]?.text.startsWith(" ".repeat(15) + "word"));
  assert.ok(lines.every((line) => line.text.length <= 60));

  const scrolled = pressSkillsManager(state, [long], "down").state;
  const first = layoutSkillsManager({ state: scrolled, skills: [long], error: null, cwd: CWD, home: HOME, columns: 60, rows: 6 });
  assert.equal(first[0]?.text, "");
});
