import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMANDS } from "./commands.ts";
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

test("/de then Tab is /debug, and /debug m then Tab is /debug model", () => {
  const names = suggest("/de", COMMANDS);
  assert.deepEqual(
    names.map((item) => item.label),
    ["/debug"],
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
