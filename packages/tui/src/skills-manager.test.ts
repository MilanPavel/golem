import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedSkill } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  closedSkillsManager,
  layoutSkillsManager,
  openNewSkill,
  openSkillsManager,
  pressSkillsManager,
  SKILLS_HINT,
  skillsManagerKeyOf,
  showSkillDetail,
  skillCreateFailed,
  skillsManagerTyping,
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
  assert.equal(key(null, "x"), null);
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
    "↑/↓ to navigate · Enter to open · n new skill · e edit · Esc to close",
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
  assert.deepEqual(state.view, { kind: "detail", path: ship.path, selected: 0 });
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
    "❯ 1. Run in this chat",
    "  2. Pin in this chat",
    "  3. Edit SKILL.md",
    "  4. Turn off",
    "  5. Reveal the folder",
    "",
    "↑/↓ to navigate · Enter to select · Esc to go back",
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

test("a long description wraps under its label, and the chosen action stays on screen", () => {
  const long = { ...notes, description: "word ".repeat(60).trim(), warnings: [] };
  const state: SkillsManagerState = { open: true, view: { kind: "detail", path: long.path, selected: 0 } };
  const lines = layoutSkillsManager({ state, skills: [long], error: null, cwd: CWD, home: HOME, columns: 60, rows: 40 });
  const description = lines.findIndex((line) => line.text.startsWith("Description:"));
  assert.ok(lines[description + 1]?.text.startsWith(" ".repeat(15) + "word"));
  assert.ok(lines.every((line) => line.text.length <= 60));

  const third = pressSkillsManager(pressSkillsManager(state, [long], "down").state, [long], "down").state;
  const small = layoutSkillsManager({ state: third, skills: [long], error: null, cwd: CWD, home: HOME, columns: 60, rows: 6 });
  assert.ok(small.some((line) => line.text === "❯ 3. Edit SKILL.md"));
});

const bundled: ListedSkill = {
  name: "release-notes",
  description: "Write release notes.",
  source: "bundled",
  path: "/opt/golem/skills/release-notes",
  usable: true,
};

function detailOf(skill: ListedSkill, ...keys: SkillsManagerKey[]) {
  let current: SkillsManagerState = { open: true, view: { kind: "detail", path: skill.path, selected: 0 } };
  let action: ReturnType<typeof pressSkillsManager>["action"] = { kind: "none" };
  for (const key of keys) {
    ({ state: current, action } = pressSkillsManager(current, [skill], key));
  }
  return { state: current, action };
}

test("keys: e and n are shortcuts in the list, text in the form, and digits pick actions", () => {
  const key = (input: string, typing = false) =>
    skillsManagerKeyOf({ name: null, input, ctrl: false, meta: false }, typing);
  assert.equal(key("e"), "edit");
  assert.equal(key("n"), "new");
  assert.equal(key("3"), 3);
  assert.deepEqual(key("e", true), { text: "e" });
  assert.deepEqual(key("3", true), { text: "3" });
  assert.equal(skillsManagerTyping(openNewSkill()), true);
  assert.equal(skillsManagerTyping(openSkillsManager()), false);
});

test("e in the list edits the selected skill's folder, and a bundled skill is not edited", () => {
  assert.deepEqual(press(openSkillsManager(), "edit").action, { kind: "edit", path: ship.path });
  assert.deepEqual(press(openSkillsManager(), "down", "edit").action, { kind: "edit", path: notes.path });
  assert.deepEqual(pressSkillsManager(openSkillsManager(), [bundled], "edit").action, { kind: "none" });
});

test("the detail's numbered actions: run, pin or unpin, edit, turn off or on, reveal", () => {
  assert.deepEqual(detailOf(ship, 1).action, { kind: "run", name: "ship" });
  assert.deepEqual(detailOf(ship, 2).action, { kind: "pin", name: "ship", pin: true });
  assert.deepEqual(detailOf(ship, 3).action, { kind: "edit", path: ship.path });
  assert.deepEqual(detailOf(ship, 4).action, { kind: "set-disabled", name: "ship", disabled: true });
  assert.deepEqual(detailOf(ship, 5).action, { kind: "reveal", path: ship.path });
  assert.deepEqual(detailOf(ship, "down", "down", "enter").action, { kind: "edit", path: ship.path });
  assert.deepEqual(detailOf(ship, 6).action, { kind: "none" });

  const view: SkillsManagerState = { open: true, view: { kind: "detail", path: ship.path, selected: 0 } };
  assert.deepEqual(pressSkillsManager(view, [ship], 2, ["ship"]).action, { kind: "pin", name: "ship", pin: false });
  const lines = layoutSkillsManager({
    state: view,
    skills: [ship],
    error: null,
    cwd: CWD,
    home: HOME,
    columns: 100,
    rows: 40,
    pinned: ["ship"],
  }).map((line) => line.text);
  assert.ok(lines.includes("  2. Unpin from this chat"));

  assert.deepEqual(detailOf(off, 2).action, { kind: "set-disabled", name: "pdf", disabled: false });
  assert.ok(shown({ open: true, view: { kind: "detail", path: off.path, selected: 0 } }, [off]).includes("  2. Turn on"));
});

test("a bundled skill offers Copy to Yours, not Edit", () => {
  const lines = shown({ open: true, view: { kind: "detail", path: bundled.path, selected: 0 } }, [bundled]);
  assert.ok(lines.includes("  3. Copy to Yours"));
  assert.ok(!lines.some((line) => line.includes("Edit SKILL.md")));
  assert.deepEqual(detailOf(bundled, 3).action, { kind: "copy", name: "release-notes" });
});

test("a broken skill shows its error in the detail, and a fixed one is usable again", () => {
  const before = shown({ open: true, view: { kind: "detail", path: broken.path, selected: 0 } }, [broken]);
  assert.ok(before.includes("✘ the frontmatter is not valid YAML: line 3: expected ',' or ']'"));
  assert.ok(before.includes("Status:        ✘ broken: never used"));
  const fixed: ListedSkill = { ...broken, usable: true, errors: [], description: "Fixed." };
  const after = shown(showSkillDetail(openSkillsManager(), broken.path), [fixed]);
  assert.ok(after.includes("Status:        ✔ usable"));
  assert.ok(!after.includes("Errors"));
});

function typed(state: SkillsManagerState, text: string): SkillsManagerState {
  return pressSkillsManager(state, SKILLS, { text }).state;
}

test("n walks name, where, and description, then asks for skill.create", () => {
  let state = press(openSkillsManager(), "new").state;
  assert.equal(state.view.kind, "new");
  assert.equal(shown(state)[0], "New skill · 1 of 3");

  state = typed(state, "morning-brief");
  state = pressSkillsManager(state, SKILLS, "enter").state;
  assert.deepEqual(shown(state).slice(0, 6), [
    "New skill · 2 of 3",
    "",
    "  Name:        morning-brief",
    "  Where:",
    "❯ 1. Yours (~/.golem/skills)",
    "  2. This project (~/repo/.agents/skills)",
  ]);
  state = pressSkillsManager(state, SKILLS, "down").state;
  state = pressSkillsManager(state, SKILLS, "enter").state;
  assert.equal(shown(state)[0], "New skill · 3 of 3");
  assert.ok(shown(state).includes("  Where:       This project (~/repo/.agents/skills)"));

  state = typed(state, "Summarize  the day.");
  const done = pressSkillsManager(state, SKILLS, "enter");
  assert.deepEqual(done.action, {
    kind: "create",
    name: "morning-brief",
    scope: "project",
    description: "Summarize the day.",
  });
  assert.equal(done.state.view.kind, "creating");
  assert.deepEqual(pressSkillsManager(done.state, SKILLS, "back").action, { kind: "none" });

  const failed = skillCreateFailed(done.state, "already exists");
  assert.equal(failed.view.kind, "new");
  assert.ok(shown(failed).includes("✘ already exists"));
});

test("a bad name or an empty description stays on its step with why", () => {
  const bad = pressSkillsManager(typed(openNewSkill(), "Bad Name"), SKILLS, "enter").state;
  assert.equal(shown(bad)[0], "New skill · 1 of 3");
  assert.ok(shown(bad).some((line) => line.startsWith("✘ Use up to 64 lowercase")));
  assert.equal(pressSkillsManager(openNewSkill(), SKILLS, "enter").state.view.kind, "new");

  let described = typed(openNewSkill(), "ok-name");
  described = pressSkillsManager(described, SKILLS, "enter").state;
  described = pressSkillsManager(described, SKILLS, "enter").state;
  const empty = pressSkillsManager(described, SKILLS, "enter");
  assert.equal(empty.action.kind, "none");
  assert.ok(shown(empty.state).some((line) => line.startsWith("✘ Describe it in one line")));
});

test("Esc goes back a step at each step, then to the list; Backspace edits", () => {
  let state = typed(openNewSkill(), "ok-name");
  state = pressSkillsManager(state, SKILLS, "enter").state;
  state = pressSkillsManager(state, SKILLS, "enter").state;
  const steps: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    state = pressSkillsManager(state, SKILLS, "back").state;
    steps.push(state.view.kind === "new" ? state.view.step : state.view.kind);
  }
  assert.deepEqual(steps, ["where", "name", "list"]);
  const name = pressSkillsManager(typed(openNewSkill(), "ab"), SKILLS, "delete").state;
  assert.equal(name.view.kind === "new" ? name.view.name : "", "a");
});
