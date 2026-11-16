import assert from "node:assert/strict";
import { test } from "node:test";

import type { CheckUpdate } from "@golem/client";

import type { ModelCheckCase } from "../../protocol/gen/model-check-case.ts";
import type { ModelCheckDone } from "../../protocol/gen/model-check-done.ts";
import { type CheckClient, formatCheckSummary, runModelsCheck } from "./models-check.ts";

const REF = "ollama/qwen3:27b";

function item(id: string, title: string, outcome: ModelCheckCase["outcome"], ms: number, detail?: string): ModelCheckCase {
  return { id, title, outcome, ms, detail: detail ?? null };
}

const CASES: ModelCheckCase[] = [
  item("read_file", "read a file", "pass", 1200),
  item("search", "search", "pass", 1400),
  item("nested", "nested arguments", "recovered", 2000, "written as text, recovered"),
  item("missing", "missing argument", "fail", 1100, "invalid arguments for read_file: path is required"),
];

function done(patch: Partial<ModelCheckDone>): ModelCheckDone {
  return { ref: REF, ok: true, cases: CASES, passed: 2, recovered: 1, total: 4, verdict: "usable", ...patch };
}

/** A daemon that answers `model.check` and then sends the given updates, one per tick. */
function fakeClient(updates: CheckUpdate[]): CheckClient {
  let listener: ((update: CheckUpdate) => void) | null = null;
  return {
    onCheck: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    checkModel: async (name) => {
      assert.equal(name, "qwen3:27b");
      setImmediate(() => {
        for (const update of updates) {
          listener?.(update);
        }
      });
      return { ref: REF, started: true };
    },
  };
}

test("each case prints as it ends, then the verdict line", async () => {
  const updates: CheckUpdate[] = [
    ...CASES.map((result, index): CheckUpdate => ({
      kind: "progress",
      progress: { ref: REF, index: index + 1, total: CASES.length, result },
    })),
    { kind: "progress", progress: { ref: "ollama/other", index: 1, total: 1, result: item("x", "other model", "pass", 1) } },
    { kind: "done", done: done({}) },
  ];
  const out: string[] = [];
  const code = await runModelsCheck(fakeClient(updates), "qwen3:27b", (line) => out.push(line), () => {});
  assert.equal(code, 0);
  assert.deepEqual(out, [
    "qwen3:27b on this Mac",
    "✓ read a file             1.2 s",
    "✓ search                  1.4 s",
    "~ nested arguments        2.0 s   written as text, recovered",
    "✗ missing argument        1.1 s   invalid arguments for read_file: path is required",
    "2 of 4 passed · 1 recovered · usable; golem will step up when it fails",
  ]);
});

test("a check that stops with an error prints the error and fails", async () => {
  const errors: string[] = [];
  const stopped = done({ ok: false, error: "qwen3:27b does not take tools", cases: [], verdict: null });
  const code = await runModelsCheck(
    fakeClient([{ kind: "done", done: stopped }]),
    "qwen3:27b",
    () => {},
    (line) => errors.push(line),
  );
  assert.equal(code, 1);
  assert.deepEqual(errors, ["qwen3:27b does not take tools"]);
});

test("the summary names the cost of a hosted model and each verdict", () => {
  assert.equal(
    formatCheckSummary(done({ passed: 10, recovered: 0, total: 10, verdict: "reliable", cost_usd: 0.034 })),
    "10 of 10 passed · tool calls look reliable · cost about $0.03",
  );
  assert.equal(
    formatCheckSummary(done({ passed: 3, recovered: 0, total: 10, verdict: "not_recommended", cost_usd: 0 })),
    "3 of 10 passed · not recommended for tool work",
  );
});
