import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMANDS, withModelChoices, withSkillChoices, type SkillChoice } from "./commands.ts";
import {
  applySuggestion,
  moveSuggestion,
  suggest,
  suggestionWindow,
  type SuggestCommand,
} from "./suggest.ts";

const registry: readonly SuggestCommand[] = [
  { name: "/scatter", description: "Spreads" },
  { name: "/cat", description: "An animal", choices: ["siamese", "tabby"] },
  { name: "/only", description: "Just this" },
];

test("/model suggests the names it is given", () => {
  const names = suggest("/model so", withModelChoices(COMMANDS, ["qwen", "sonnet", "ollama/qwen3:8b"]));
  assert.deepEqual(
    names.map((item) => item.completion),
    ["/model sonnet"],
  );
});

test("/de then Tab is /debug, and /debug m then Tab is /debug model", () => {
  const names = suggest("/de", COMMANDS);
  assert.deepEqual(
    names.map((item) => item.label),
    ["/debug", "/model"],
  );
  assert.equal(names[0]?.partial, true);
  assert.deepEqual(applySuggestion("/de", names, 0, "tab"), { draft: "/debug ", submit: false });
  assert.deepEqual(applySuggestion("/de", names, 0, "enter"), { draft: "/debug ", submit: false });

  const args = suggest("/debug m", COMMANDS);
  assert.deepEqual(
    args.map((item) => item.label),
    ["model"],
  );
  assert.deepEqual(applySuggestion("/debug m", args, 0, "tab"), { draft: "/debug model", submit: false });
  assert.deepEqual(applySuggestion("/debug model", suggest("/debug model", COMMANDS), 0, "enter"), {
    draft: "/debug model",
    submit: true,
  });
});

test("a doubled slash never opens suggestions", () => {
  assert.deepEqual(suggest("//debug", COMMANDS), []);
  assert.deepEqual(suggest("//", COMMANDS), []);
  assert.deepEqual(suggest("hello", COMMANDS), []);
  assert.deepEqual(suggest("", COMMANDS), []);
});

test("suggestions come from the registry, prefix before substring", () => {
  assert.deepEqual(
    suggest("/", registry).map((item) => item.label),
    ["/scatter", "/cat", "/only"],
  );
  assert.deepEqual(
    suggest("/cat", registry).map((item) => item.label),
    ["/cat", "/scatter"],
  );
  assert.equal(suggest("/only", registry)[0]?.partial, false);
  assert.deepEqual(applySuggestion("/only", suggest("/only", registry), 0, "enter"), {
    draft: "/only",
    submit: true,
  });
  assert.deepEqual(applySuggestion("/only", suggest("/only", registry), 0, "tab"), {
    draft: "/only ",
    submit: false,
  });

  assert.deepEqual(
    suggest("/cat ", registry).map((item) => item.label),
    ["siamese", "tabby"],
  );
  assert.equal(suggest("/cat ", registry)[0]?.partial, false);
  assert.deepEqual(applySuggestion("/cat s", suggest("/cat s", registry), 0, "tab"), {
    draft: "/cat siamese",
    submit: false,
  });
  assert.deepEqual(suggest("/cat siamese more", registry), []);
  assert.deepEqual(suggest("/only ", registry), []);
  assert.deepEqual(suggest("/missing", registry), []);
});

test("the selection stops at the ends and stays on screen", () => {
  assert.equal(moveSuggestion(0, "up", 4), 0);
  assert.equal(moveSuggestion(0, "down", 4), 1);
  assert.equal(moveSuggestion(3, "down", 4), 3);
  assert.deepEqual(suggestionWindow(10, 0, 6), { start: 0, index: 0 });
  assert.deepEqual(suggestionWindow(10, 6, 6), { start: 1, index: 6 });
  assert.deepEqual(suggestionWindow(3, 2, 6), { start: 0, index: 2 });
});

const SKILLS: readonly SkillChoice[] = [
  { name: "ship", description: "Open a pull request.", argumentHint: "[hint]" },
  { name: "setup", description: "Make a checkout ready.", argumentHint: null },
  { name: "help", description: "Named like a command.", argumentHint: null },
];

test("skills are suggested after the commands, with their argument hint", () => {
  const items = suggest("/sh", withSkillChoices(COMMANDS, SKILLS));
  assert.deepEqual(
    items.map((item) => [item.label, item.completion, item.description]),
    [["/ship [hint]", "/ship ", "Open a pull request."]],
  );
  assert.deepEqual(applySuggestion("/ship", suggest("/ship", withSkillChoices(COMMANDS, SKILLS)), 0, "enter"), {
    draft: "/ship",
    submit: true,
  });
});

test("a skill named like a command is suggested only after /skill run", () => {
  const registry = withSkillChoices(COMMANDS, SKILLS);
  assert.deepEqual(
    registry.filter((command) => command.name === "/help").map((command) => command.description),
    [COMMANDS.find((command) => command.name === "/help")?.description],
  );

  const names = suggest("/skill run ", registry);
  assert.deepEqual(
    names.map((item) => item.label),
    ["ship", "setup", "help"],
  );
  const help = suggest("/skill run he", registry);
  assert.deepEqual(
    help.map((item) => item.completion),
    ["/skill run help "],
  );
  assert.deepEqual(applySuggestion("/skill run he", help, 0, "tab"), { draft: "/skill run help ", submit: false });
  assert.deepEqual(suggest("/skill run help now", registry), []);
});

test("/skill suggests run, and nothing after run without skills", () => {
  assert.deepEqual(
    suggest("/skill ", COMMANDS).map((item) => item.label),
    ["run"],
  );
  assert.deepEqual(suggest("/skill run ", COMMANDS), []);
});
