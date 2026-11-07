// The story both demo recordings tell (`just demo-web`, `just demo-tui`): a project whose test
// fails on an empty list. golem reads the code, edits it after you allow the diff, runs the
// tests after you allow the command, and says what it did. The model is the scripted fake one,
// so every take is the same, and the daemon, the tools, and the approvals are real.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FakeModel } from "./fake-model.ts";
import { REPO, startDaemon, type Daemon } from "./harness.ts";

export const DEMO_ASK = "The tests fail on an empty list. Can you fix it?";

/** The version both recordings show, for the TUI and for the daemon. */
export const DEMO_VERSION = "0.9.0";

/**
 * Starts the daemon reporting DEMO_VERSION. It reads its version from golem/_build.py once, at
 * start, as a release build does (scripts/dist.sh); the file is gone again once it is up.
 */
export async function startDemoDaemon(home: string): Promise<Daemon> {
  const build = path.join(REPO, "packages/daemon/golem/_build.py");
  writeFileSync(build, `VERSION = "${DEMO_VERSION}"\n`);
  try {
    return await startDaemon(home);
  } finally {
    rmSync(build, { force: true });
  }
}

/**
 * The config for the scripted model, named as the local model the story stands for. A profile
 * named like a ref (provider/name) makes the header show the model's name alone.
 */
export function demoConfig(model: Pick<FakeModel, "baseUrl">): string[] {
  return [
    "session_titles = false",
    'model_profile = "openai_compat/qwen3-coder:30b"',
    'model_provider = "openai_compat"',
    'model_name = "qwen3-coder:30b"',
    `model_base_url = "${model.baseUrl}"`,
  ];
}

const STATS = `def average(values):
    """The mean of values."""
    return sum(values) / len(values)
`;

const TESTS = `import unittest

from stats import average


class AverageTest(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(average([2, 4, 6]), 4)

    def test_one(self):
        self.assertEqual(average([5]), 5)

    def test_empty(self):
        self.assertEqual(average([]), 0)


if __name__ == "__main__":
    unittest.main()
`;

/** Writes the demo project into `dir` (created if missing) and returns `dir`. */
export function writeDemoProject(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "stats.py"), STATS);
  writeFileSync(path.join(dir, "test_stats.py"), TESTS);
  return dir;
}

/** Queues the model's side of the story: read, edit, run the tests, answer. */
export function queueDemo(model: FakeModel, delayMs = 45): void {
  model.toolCall("read_file", { path: "stats.py" }, { delayMs });
  model.toolCall(
    "edit_file",
    {
      path: "stats.py",
      old_string: "    return sum(values) / len(values)",
      new_string: "    if not values:\n        return 0\n    return sum(values) / len(values)",
    },
    { delayMs },
  );
  model.toolCall("shell", { command: "python3 -m unittest -v" }, { delayMs });
  model.reply(
    "Fixed. `average([])` divided by zero, so it now returns 0 for an empty list. " +
      "All three tests pass, and nothing else in `stats.py` changed.",
    { delayMs },
  );
}
