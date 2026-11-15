import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthKeyStatus, ListedSkill } from "@golem/client";

import { keyWhere } from "./key-where.ts";
import { skillFacts, skillIssues, skillMark, skillRunAs, skillStatusWord, skillSummary } from "./skills-view.ts";

const HOME = "/Users/me";
const base: ListedSkill = {
  name: "ship",
  description: "Take the changes to a pull request.\nSecond line.",
  source: "user",
  path: "/Users/me/.golem/skills/ship",
  usable: true,
  argument_hint: "[hint]",
};

test("a usable skill says usable and runs as /name [hint]", () => {
  assert.deepEqual(skillMark(base), { text: "✔", tone: "ok" });
  assert.equal(skillStatusWord(base, HOME), "usable");
  assert.equal(skillRunAs(base), "/ship [hint]");
  assert.equal(skillSummary(base, HOME), "Take the changes to a pull request.");
});

test("a broken skill shows its first error, and lists errors before warnings", () => {
  const broken = { ...base, usable: false, errors: ["line 3: bad", "second"], warnings: ["careful"] };
  assert.deepEqual(skillMark(broken), { text: "✘", tone: "bad" });
  assert.equal(skillStatusWord(broken, HOME), "broken: never used");
  assert.equal(skillSummary(broken, HOME), "line 3: bad");
  assert.deepEqual(skillIssues(broken), [
    { tone: "bad", text: "line 3: bad" },
    { tone: "bad", text: "second" },
    { tone: "wait", text: "careful" },
  ]);
});

test("a disabled skill and a shadowed skill say why they are not used", () => {
  const disabled = { ...base, usable: false, disabled: true };
  assert.deepEqual(skillMark(disabled), { text: "–", tone: "off" });
  assert.equal(skillSummary(disabled, HOME), "disabled in config.toml");
  const shadowed = { ...base, usable: false, shadowed_by: "/Users/me/repo/.agents/skills/ship" };
  assert.equal(skillStatusWord(shadowed, HOME), "hidden by the skill in /Users/me/repo/.agents/skills/ship".replace(HOME, "~"));
  assert.equal(skillSummary(shadowed, ""), "hidden by /Users/me/repo/.agents/skills/ship");
});

test("a warned skill is usable with a wait mark", () => {
  const warned = { ...base, warnings: ["`context` is ignored"] };
  assert.deepEqual(skillMark(warned), { text: "!", tone: "wait" });
  assert.equal(skillStatusWord(warned, HOME), "usable, with warnings");
});

test("the facts are the TUI's rows, with paths in full for an empty home", () => {
  const facts = skillFacts({ ...base, model_invocable: false, allowed_tools: ["Read", "Bash(git *)"], model: "m" }, "");
  assert.deepEqual(
    facts.map((fact) => fact.label),
    ["Status", "From", "Folder", "Description", "You run it", "Model uses it", "Allowed tools", "Model"],
  );
  assert.equal(facts[2]?.text, "/Users/me/.golem/skills/ship");
  assert.equal(facts[5]?.text, "no, only you");
  assert.equal(facts[6]?.text, "Read, Bash(git *)");
  assert.equal(facts[7]?.text, "m (not used yet)");
});

function status(over: Partial<AuthKeyStatus>): AuthKeyStatus {
  return { provider: "anthropic", takes_key: true, needs_key: true, source: null, env_var: null, ...over };
}

test("keyWhere says where a key is, or what is missing", () => {
  assert.equal(keyWhere(status({ source: "env", env_var: "ANTHROPIC_API_KEY" })), "from ANTHROPIC_API_KEY");
  assert.equal(keyWhere(status({ source: "keychain" })), "in the Keychain");
  assert.equal(keyWhere(status({})), "missing: golem auth set anthropic");
  assert.equal(keyWhere(status({ needs_key: false })), "none needed");
});
