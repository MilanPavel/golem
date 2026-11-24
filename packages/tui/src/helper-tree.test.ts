import assert from "node:assert/strict";
import { test } from "node:test";

import type { BatchHelper, ChatMessage, HelperBatch, ToolBlock } from "@golem/view";

import { batchLines } from "./helper-tree.ts";
import { layoutMessages, type Span } from "./layout-chat.ts";

const textOf = (spans: readonly Span[]): string => spans.map((span) => span.text).join("");
const rowsOf = (lines: readonly (readonly Span[])[]): string[] => lines.map(textOf);

function step(id: string, name: string, status: ToolBlock["status"] = "done"): ToolBlock {
  return { callId: id, name, args: {}, status };
}

function helper(index: number, over: Partial<BatchHelper>): BatchHelper {
  return {
    index,
    label: "auth",
    agent: "explorer",
    model: "m",
    wish: null,
    pickReason: "the cheapest ready model",
    local: true,
    state: "queued",
    reason: null,
    line: null,
    position: null,
    holder: null,
    retryInMs: null,
    spentUsd: null,
    capUsd: null,
    stopped: null,
    steps: [],
    tokens: null,
    answerTokens: null,
    costUsd: null,
    durationMs: null,
    ...over,
  };
}

/** One of each story: done, running, waiting for you. `cost` 0 is the local-only batch. */
function batch(model: string, local: boolean, cost: number): HelperBatch {
  return {
    callId: "d1",
    parked: true,
    helpers: [
      helper(0, {
        label: "auth",
        model,
        local,
        state: "done",
        steps: [step("a1", "read_file"), step("a2", "grep")],
        tokens: 14_000,
        answerTokens: 620,
        costUsd: cost,
        durationMs: 72_000,
        stopped: "done",
      }),
      helper(1, { label: "billing", model, local, state: "running", steps: [step("b1", "read_file", "running")] }),
      helper(2, { label: "docs", model, local, state: "waiting", reason: "you" }),
    ],
  };
}

const localOnly = batch("qwen3:27b", true, 0);
const cloudOnly = batch("claude-haiku", false, 0.04);

test("local only, Normal at 80 columns: a head, then a row per helper with the window saved", () => {
  const lines = batchLines(localOnly, 80, "normal");
  const rows = rowsOf(lines);
  assert.deepEqual(rows, [
    "▾ 3 helpers · 1 running · 1 waiting · 1 done · 14K to 0.6K       waiting for you",
    "  ├─ ✓ auth  read 1 file, 1 search                     14K to 0.6K  done  1m 12s",
    "  ├─ ■ billing  read 1 file                                              running",
    "  └─ ■ docs                                                      waiting for you",
  ]);
  for (const row of rows) assert.equal([...row].length <= 80, true, row);
});

test("cloud only, Normal: the cost comes first", () => {
  const rows = rowsOf(batchLines(cloudOnly, 80, "normal"));
  for (const row of rows) assert.equal([...row].length <= 80, true, row);
  // The head is the middle of its line: it gives way, the wait on the right does not.
  assert.match(rows[0] ?? "", /^▾ 3 helpers · 1 running · 1 waiting · 1 done · \$0\.04 · 14K to ?…? +waiting for you$/);
  assert.match(rows[1] ?? "", /\$0\.04 · 14K to 0\.6K {2}done {2}1m 12s$/);
  assert.equal(rows[1]?.includes("$"), true);
});

test("Quiet is one grey line", () => {
  for (const sample of [localOnly, cloudOnly]) {
    const lines = batchLines(sample, 80, "quiet");
    assert.equal(lines.length, 1);
    assert.equal(textOf(lines[0] ?? []), "3 helpers · 1 running · 1 waiting · 1 done");
    assert.equal(lines[0]?.every((span) => span.dim === true), true);
  }
});

test("Verbose adds the model and why, local and cloud", () => {
  const local = rowsOf(batchLines(localOnly, 80, "verbose"));
  assert.equal(local.length, 7);
  assert.match(local[2] ?? "", /^ {2}│ +qwen3:27b · the cheapest ready model$/);
  assert.match(local[6] ?? "", /^ {5} +qwen3:27b · the cheapest ready model$/);
  const cloud = rowsOf(batchLines(cloudOnly, 80, "verbose"));
  assert.match(cloud[2] ?? "", /claude-haiku · the cheapest ready model$/);
  assert.match(cloud[1] ?? "", /\$0\.04 · 14K to 0\.6K/);
});

test("the marks: working green, queued hollow, asking yellow, done and failed", () => {
  const sample: HelperBatch = {
    callId: "d1",
    parked: false,
    helpers: [
      helper(0, { label: "a", state: "running" }),
      helper(1, { label: "b", state: "queued" }),
      helper(2, { label: "c", state: "waiting", reason: "you" }),
      helper(3, { label: "d", state: "done", stopped: "done", tokens: 1, answerTokens: 1, costUsd: 0, durationMs: 1000 }),
      helper(4, { label: "e", state: "failed", stopped: "failed" }),
      helper(5, { label: "f", state: "stopped", stopped: "time" }),
    ],
  };
  const lines = batchLines(sample, 80, "normal");
  const mark = (at: number): Span | undefined => lines[at]?.[1];
  assert.deepEqual([mark(1)?.text, mark(1)?.color], ["■", "green"]);
  assert.deepEqual([mark(2)?.text, mark(2)?.dim], ["□", true]);
  assert.deepEqual([mark(3)?.text, mark(3)?.warn], ["■", true]);
  assert.deepEqual([mark(4)?.text, mark(4)?.color], ["✓", "green"]);
  assert.deepEqual([mark(5)?.text, mark(5)?.color], ["✗", "red"]);
  assert.equal(mark(6)?.text, "✗");
});

test("narrow widths cut the middle, never the state or the time", () => {
  for (const width of [60, 40, 30]) {
    for (const sample of [localOnly, cloudOnly]) {
      const rows = rowsOf(batchLines(sample, width, "normal"));
      for (const row of rows) assert.equal([...row].length <= width, true, `${String(width)}: ${row}`);
      assert.match(rows[1] ?? "", /done/);
      assert.match(rows[2] ?? "", /running$/);
      assert.match(rows[3] ?? "", /waiting for/);
    }
  }
  const tight = rowsOf(batchLines(localOnly, 40, "normal"));
  assert.match(tight[1] ?? "", /…|auth/);
  assert.match(tight[1] ?? "", /done {2}1m 12s$/);
});

test("the isLocal hook decides the number when the helpers did not say", () => {
  const unknown: HelperBatch = { ...cloudOnly, helpers: cloudOnly.helpers.map((each) => ({ ...each, local: null })) };
  const asLocal = rowsOf(batchLines(unknown, 80, "normal", () => true));
  assert.equal(asLocal[1]?.includes("$"), false);
  const asCloud = rowsOf(batchLines(unknown, 80, "normal", () => false));
  assert.equal(asCloud[1]?.includes("$0.04"), true);
});

function turn(tool: ToolBlock): ChatMessage[] {
  return [
    { id: "u1", role: "user", text: "look", streaming: false },
    { id: "a1", role: "assistant", text: "", streaming: false, tools: [tool] },
  ];
}

test("under a turn, a call with a batch is a tree, at each level", () => {
  const call: ToolBlock = { callId: "d1", name: "delegate", args: { brief: "look" }, status: "running" };
  const at = (detail: "quiet" | "normal" | "verbose"): string[] =>
    layoutMessages(turn(call), 80, { times: false, now: 0, detail, batches: { d1: localOnly } })
      .map((line) => textOf(line.spans));
  const quiet = at("quiet");
  const normal = at("normal");
  const verbose = at("verbose");
  assert.equal(quiet.filter((row) => row.startsWith("3 helpers")).length, 1);
  assert.equal(normal.filter((row) => /^ {2}[├└]─/.test(row)).length, 3);
  assert.equal(normal.length - quiet.length, 3);
  assert.equal(verbose.length - normal.length, 3);
  assert.equal(normal.some((row) => row.startsWith("▾ 3 helpers")), true);
});

test("a call of the old shape, with no batch, keeps its line", () => {
  const call: ToolBlock = { callId: "d2", name: "delegate", args: { agent: "explorer", brief: "look" }, status: "running" };
  const rows = layoutMessages(turn(call), 80, { times: false, now: 0, batches: { d1: localOnly } }).map((line) => textOf(line.spans));
  assert.equal(
    rows.some((row) => row.startsWith("▸ delegate")),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes("├─")),
    false,
  );
});
