import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_WINDOW_MS, idleInterrupt, pressCtrlC, type InterruptState } from "./interrupt.ts";

type Press = { runId: string | null; at: number; expect: "cancel" | "arm" | "exit" };

function run(presses: readonly Press[]): void {
  let state: InterruptState = idleInterrupt;
  for (const press of presses) {
    const result = pressCtrlC(state, press.runId, press.at);
    assert.equal(result.action.kind, press.expect, JSON.stringify(press));
    state = result.state;
  }
}

test("Ctrl-C walks through cancel, arm, and exit", () => {
  const cases: [string, Press[]][] = [
    [
      "idle: twice inside the window exits",
      [
        { runId: null, at: 0, expect: "arm" },
        { runId: null, at: EXIT_WINDOW_MS, expect: "exit" },
      ],
    ],
    [
      "idle: a late second press arms again",
      [
        { runId: null, at: 0, expect: "arm" },
        { runId: null, at: EXIT_WINDOW_MS + 1, expect: "arm" },
        { runId: null, at: EXIT_WINDOW_MS + 2, expect: "exit" },
      ],
    ],
    [
      "busy: the first press cancels, then the exit arms",
      [
        { runId: "r_1", at: 0, expect: "cancel" },
        { runId: "r_1", at: 10, expect: "arm" },
        { runId: "r_1", at: 20, expect: "exit" },
      ],
    ],
    [
      "a cancel disarms the exit",
      [
        { runId: null, at: 0, expect: "arm" },
        { runId: "r_1", at: 10, expect: "cancel" },
        { runId: null, at: 20, expect: "arm" },
      ],
    ],
    [
      "a new run can be cancelled too",
      [
        { runId: "r_1", at: 0, expect: "cancel" },
        { runId: "r_2", at: 5_000, expect: "cancel" },
      ],
    ],
  ];
  for (const [name, presses] of cases) {
    try {
      run(presses);
    } catch (error) {
      throw new Error(`${name}: ${String(error)}`);
    }
  }
});

test("a cancel names the run", () => {
  const { action } = pressCtrlC(idleInterrupt, "r_9", 0);
  assert.deepEqual(action, { kind: "cancel", runId: "r_9" });
});
