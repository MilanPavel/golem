import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvalRoutingResult } from "../../protocol/gen/eval-routing-result.ts";
import { formatEvalRouting, parseEvalArgs } from "./format-eval.ts";

const row = { calls: 10, input: 1, output: 1, clears: 0, summaries: 0 };

const REPORT: EvalRoutingResult = {
  days: 14,
  sessions: 37,
  calls: 1912,
  skipped: 3,
  scenarios: [
    { ...row, name: "pinned frontier", cost_usd: 41.2, cuts: 0, step_ups: null, peak_share: 0.09 },
    { ...row, name: "pinned local", cost_usd: 0, cuts: 212, step_ups: null, peak_share: 1 },
    { ...row, name: "auto", cost_usd: 1.84, cuts: 0, step_ups: 23, peak_share: 0.78 },
  ],
  actual: { ...row, name: "as it really ran", cost_usd: 0, cuts: 187 },
  top: [{ session_id: "s_1", calls: 12, cost_usd: 0.5 }],
};

test("formatEvalRouting prints the table, the skipped calls and the dearest sessions", () => {
  assert.equal(
    formatEvalRouting(REPORT),
    [
      "14 days · 37 sessions · 1,912 model calls",
      "                  cost    cut prompts  step-ups  peak ctx",
      "pinned frontier   $41.20  0            –         9%",
      "pinned local      $0.00   212          –         100%",
      "auto              $1.84   0            23        78%",
      "as it really ran  $0.00   187",
      "",
      "3 model calls skipped: no sizes recorded, or the call failed",
      "",
      "where auto would have spent most:",
      "  s_1  $0.50  12 calls",
    ].join("\n"),
  );
});

test("formatEvalRouting says so when nothing could be sized", () => {
  const text = formatEvalRouting({ ...REPORT, sessions: 0, calls: 0, scenarios: [], top: [] });
  assert.match(text, /no recorded model call could be sized \(3 skipped\)/);
});

test("parseEvalArgs reads --days and --session and refuses the rest", () => {
  assert.deepEqual(parseEvalArgs([]), {});
  assert.deepEqual(parseEvalArgs(["--days", "7", "--session", "s_1"]), { days: 7, sessionId: "s_1" });
  assert.equal(parseEvalArgs(["--days", "0"]), null);
  assert.equal(parseEvalArgs(["--days"]), null);
  assert.equal(parseEvalArgs(["--what", "1"]), null);
});
