import assert from "node:assert/strict";
import { test } from "node:test";

import { pressStarter, starterLines, starterPrompts, startersShown } from "./starter-prompts.ts";

test("the prompts fit the folder: a git repo, an empty folder, or any other", () => {
  const git = starterPrompts({ git: true, empty: false });
  assert.equal(git[0], "Explain this project");
  assert.ok(git.includes("Find TODOs and group them"));
  assert.equal(starterPrompts({ git: false, empty: true })[0], "What can you do?");
  assert.ok(starterPrompts({ git: false, empty: false }).includes("What can you do?"));
  for (const facts of [
    { git: true, empty: false },
    { git: false, empty: true },
    { git: false, empty: false },
  ]) {
    const count = starterPrompts(facts).length;
    assert.ok(count >= 2 && count <= 3);
  }
});

test("they show in an empty chat with an empty composer, and go once a message is sent", () => {
  assert.ok(startersShown({ messages: 0, draft: "", busy: false }));
  assert.ok(!startersShown({ messages: 0, draft: "E", busy: false }));
  assert.ok(!startersShown({ messages: 0, draft: "", busy: true }));
  assert.ok(!startersShown({ messages: 1, draft: "", busy: false }));
});

test("Down picks one, Up and Down move, Up from the first leaves, Enter fills the composer", () => {
  const prompts = starterPrompts({ git: true, empty: false });
  assert.deepEqual(pressStarter(null, "up", prompts), { kind: "pass" });
  assert.deepEqual(pressStarter(null, "enter", prompts), { kind: "pass" });
  assert.deepEqual(pressStarter(null, "escape", prompts), { kind: "pass" });
  assert.deepEqual(pressStarter(null, "down", prompts), { kind: "pick", pick: 0 });
  assert.deepEqual(pressStarter(0, "down", prompts), { kind: "pick", pick: 1 });
  assert.deepEqual(pressStarter(prompts.length - 1, "down", prompts), { kind: "pick", pick: prompts.length - 1 });
  assert.deepEqual(pressStarter(1, "up", prompts), { kind: "pick", pick: 0 });
  assert.deepEqual(pressStarter(0, "up", prompts), { kind: "pick", pick: null });
  assert.deepEqual(pressStarter(1, "escape", prompts), { kind: "pick", pick: null });
  assert.deepEqual(pressStarter(0, "enter", prompts), { kind: "fill", text: "Explain this project" });
  assert.deepEqual(pressStarter(null, "down", []), { kind: "pass" });
});

test("the list marks the picked prompt and says how to pick one", () => {
  const prompts = ["Explain this project", "Find TODOs and group them"];
  assert.deepEqual(starterLines(prompts, null), [
    { text: "  Explain this project", selected: false, dim: true },
    { text: "  Find TODOs and group them", selected: false, dim: true },
    { text: "  ↓ to pick one", selected: false, dim: true },
  ]);
  const picked = starterLines(prompts, 1);
  assert.deepEqual(picked[1], { text: "› Find TODOs and group them", selected: true, dim: false });
  assert.equal(picked[2]?.text, "  Enter puts it in the composer · Esc");
  assert.deepEqual(starterLines([], null), []);
});
