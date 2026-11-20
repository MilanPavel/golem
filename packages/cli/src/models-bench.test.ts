import assert from "node:assert/strict";
import { test } from "node:test";

import { type BenchUpdate, MODEL_NOT_CONFIGURED, RpcError } from "@golem/client";

import type { ModelBenchRow } from "../../protocol/gen/model-bench-row.ts";
import {
  type BenchClient,
  formatBenchTable,
  IDLE_NOTE,
  NO_LOCAL_MODEL,
  runModelsBench,
} from "./models-bench.ts";

const REF = "ollama/qwen3:27b";

function row(atOnce: number, each: number[], total: number, window: number): ModelBenchRow {
  return { shape: "tools", at_once: atOnce, each, total, window };
}

const ROWS: ModelBenchRow[] = [
  row(1, [32.14], 32.14, 16384),
  row(2, [30.2, 29.4], 59.6, 8192),
  row(4, [18, 17.5, 18.5, 18], 72, 4096),
];

/** A daemon that answers `model.bench` with `reply` and then sends the updates. */
function fakeClient(reply: () => { ref: string; started: boolean }, updates: BenchUpdate[]): BenchClient {
  let listener: ((update: BenchUpdate) => void) | null = null;
  return {
    onBench: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    benchModel: async (name, engine) => {
      assert.equal(name, "qwen3:27b");
      assert.equal(engine, undefined);
      const result = reply();
      setImmediate(() => {
        for (const update of updates) {
          listener?.(update);
        }
      });
      return result;
    },
  };
}

function progress(index: number, item: ModelBenchRow): BenchUpdate {
  return { kind: "progress", progress: { ref: REF, index, total: 3, row: item } };
}

test("the table prints from a fixture", () => {
  assert.equal(
    formatBenchTable(ROWS),
    [
      "at once   each (tokens/s)   total (tokens/s)   window each",
      "      1              32.1               32.1         16384",
      "      2              29.8               59.6          8192",
      "      4              18.0               72.0          4096",
    ].join("\n"),
  );
});

test("a run prints each row as it arrives, the idle note, then the table", async () => {
  const updates: BenchUpdate[] = [
    ...ROWS.map((item, index) => progress(index + 1, item)),
    { kind: "done", done: { ref: "ollama/other", ok: true, rows: [] } },
    { kind: "done", done: { ref: REF, ok: true, rows: ROWS } },
  ];
  const out: string[] = [];
  const code = await runModelsBench(
    fakeClient(() => ({ ref: REF, started: true }), updates),
    "qwen3:27b",
    undefined,
    (line) => out.push(line),
    () => {},
  );
  assert.equal(code, 0);
  assert.equal(out[0], "qwen3:27b on this Mac");
  assert.equal(out[1], IDLE_NOTE);
  assert.equal(out[2], "tools · 1 at once · 32.1 tokens/s each · 32.1 total · window 16384 each");
  assert.equal(out[4], "tools · 4 at once · 18.0 tokens/s each · 72.0 total · window 4096 each");
  assert.equal(out.slice(6).join("\n"), formatBenchTable(ROWS));
});

test("a hosted ref, or no local model, prints the fixed line and fails", async () => {
  for (const message of ["claude-sonnet is not a local model", "there is no local model to measure"]) {
    const errors: string[] = [];
    const client: BenchClient = {
      onBench: () => () => {},
      benchModel: async () => {
        throw new RpcError(MODEL_NOT_CONFIGURED, message);
      },
    };
    const code = await runModelsBench(client, "qwen3:27b", undefined, () => assert.fail("nothing prints"), (line) =>
      errors.push(line),
    );
    assert.equal(code, 1);
    assert.deepEqual(errors, ["no local model: nothing to measure here"]);
  }
  assert.equal(NO_LOCAL_MODEL, "no local model: nothing to measure here");
});

test("an unknown engine prints the daemon's reason", async () => {
  const errors: string[] = [];
  const client: BenchClient = {
    onBench: () => () => {},
    benchModel: async (_name, engine) => {
      assert.equal(engine, "vllm");
      throw new RpcError(MODEL_NOT_CONFIGURED, "golem cannot measure on vllm");
    },
  };
  const code = await runModelsBench(client, "qwen3:27b", "vllm", () => {}, (line) => errors.push(line));
  assert.equal(code, 1);
  assert.deepEqual(errors, ["golem cannot measure on vllm"]);
});

test("started false says the model is already being measured", async () => {
  const out: string[] = [];
  const errors: string[] = [];
  const code = await runModelsBench(
    fakeClient(() => ({ ref: REF, started: false }), []),
    "qwen3:27b",
    undefined,
    (line) => out.push(line),
    (line) => errors.push(line),
  );
  assert.equal(code, 1);
  assert.deepEqual(out, []);
  assert.deepEqual(errors, ["qwen3:27b on this Mac is already being measured"]);
});

test("a failed run prints the reason and the rows that finished", async () => {
  const errors: string[] = [];
  const out: string[] = [];
  const first = ROWS[0] as ModelBenchRow;
  const code = await runModelsBench(
    fakeClient(
      () => ({ ref: REF, started: true }),
      [progress(1, first), { kind: "done", done: { ref: REF, ok: false, error: "the server stopped", rows: [first] } }],
    ),
    "qwen3:27b",
    undefined,
    (line) => out.push(line),
    (line) => errors.push(line),
  );
  assert.equal(code, 1);
  assert.equal(errors[0], "the server stopped");
  assert.equal(errors[1], "rows that finished:");
  assert.equal(errors.slice(2).join("\n"), formatBenchTable([first]));
});
