import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvalUpdate } from "@golem/client";

import type { EvalMeasurement } from "../../protocol/gen/evals-get-result.ts";
import type { EvalPlanArm } from "../../protocol/gen/eval-plan-arm.ts";
import { parseHelpersArgs } from "./eval-helpers-format.ts";
import { runHelpers, type HelpersClient, type HelpersDeps } from "./eval-helpers-run.ts";

const LOCAL: EvalPlanArm = {
  asks: 10,
  kind: "local",
  label: "Local 32K",
  model: "qwen3.8:27b",
  name: "local-32k",
  tier: "local",
  window: 32768,
  needed_gb: 21.1,
  free_gb: 24.3,
  ram_gb: 36,
  verdict: "tight",
  reason: "Tight: it fits but takes most of the memory.",
};
const CLOUD: EvalPlanArm = {
  asks: 10,
  kind: "cloud",
  label: "Budget",
  model: "haiku",
  name: "budget-cloud",
  tier: "budget",
  window: 200000,
  cost_usd: 0.38,
};
const FITS: EvalPlanArm = { ...LOCAL, verdict: "fits", reason: "Fits." };

const DONE: EvalMeasurement = {
  id: "7f3a",
  arms: [{ name: "local-32k", model: "m" }],
  started_at: "2026-11-24T10:00:00.000Z",
  ended_at: "2026-11-24T10:01:00.000Z",
  state: "done",
  runs: [{ arm: "local-32k", ask: "a", mode: "on", end: "completed", quality: 1, seconds: 5, window_left: 0.5, helpers_started: 1 }],
  proposal: null,
};

interface Script {
  plan?: EvalPlanArm[];
  running?: string | null;
  /** The updates sent after `evalsStart` or `evalsResume` answers. */
  updates?: EvalUpdate[];
  measurement?: EvalMeasurement;
  startError?: Error;
}

function setup(script: Script) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: [string, unknown][] = [];
  let listener: ((update: EvalUpdate) => void) | undefined;
  let interrupt: (() => void) | undefined;
  let offs = 0;
  const emit = () => {
    for (const update of script.updates ?? []) listener?.(update);
  };
  const client = {
    evalsPlan: async (arms?: string[], models?: Record<string, string>) => {
      calls.push(["plan", { arms, models }]);
      return { arms: script.plan ?? [FITS, CLOUD], running: script.running ?? null };
    },
    evalsStart: async (params: unknown) => {
      calls.push(["start", params]);
      if (script.startError) throw script.startError;
      queueMicrotask(emit);
      return { id: "7f3a" };
    },
    evalsResume: async (id: string, allowTight?: boolean) => {
      calls.push(["resume", { id, allowTight }]);
      if (script.startError) throw script.startError;
      queueMicrotask(emit);
      return { id };
    },
    evalsStop: async (id: string) => {
      calls.push(["stop", id]);
      return { stopped: id === "7f3a" };
    },
    evalsList: async () => ({ measurements: [] }),
    evalsGet: async (id: string) => {
      calls.push(["get", id]);
      return { measurement: script.measurement ?? DONE };
    },
    evalsApply: async (id: string) => {
      calls.push(["apply", id]);
      return id === "bad"
        ? { ok: false, errors: [{ message: "config.toml has a syntax error" }] }
        : {
            ok: true,
            values: {
              keep_days: 1,
              keep_problem_days: 1,
              delegate: {
                read_share: { value: 0.42, default: 0.3, is_default: false },
                fill_share: { value: 0.8, default: 0.85, is_default: false },
                job_share: { value: 0.1, default: 0.1, is_default: true },
                price_ratio: { value: 3, default: 3, is_default: true },
              },
            },
          };
    },
    evalsDelete: async (id: string) => {
      calls.push(["delete", id]);
      return { deleted: id === "7f3a" };
    },
    onEval: (next: (update: EvalUpdate) => void) => {
      listener = next;
      return () => {
        offs += 1;
        listener = undefined;
      };
    },
  } as unknown as HelpersClient;
  const deps: HelpersDeps = {
    now: () => new Date(2026, 10, 24),
    write: (line) => out.push(line),
    error: (line) => err.push(line),
    onInterrupt: (handler) => {
      interrupt = handler;
      return () => {
        interrupt = undefined;
      };
    },
  };
  return { client, deps, out, err, calls, press: () => interrupt?.(), offs: () => offs };
}

const progress = (index: number, state: "running" | "completed"): EvalUpdate => ({
  kind: "progress",
  progress: { id: "7f3a", arm: "local-32k", ask: "a", mode: "on", index, total: 2, state, elapsed: 5 },
});
const ended = (state: "done" | "stopped"): EvalUpdate => ({ kind: "ended", ended: { id: "7f3a", state } });

const run = (t: ReturnType<typeof setup>, args: string[]) => runHelpers(t.client, parseHelpersArgs(args), t.deps);

test("no arm prints the plan and starts nothing", async () => {
  const t = setup({});
  assert.equal(await run(t, []), 0);
  assert.deepEqual(t.calls.map((c) => c[0]), ["plan"]);
  assert.match(t.out.join("\n"), /nothing was started\./);
});

test("a tight arm without --allow-tight is refused before anything starts", async () => {
  const t = setup({ plan: [LOCAL] });
  assert.equal(await run(t, ["--arm", "local-32k"]), 1);
  assert.deepEqual(t.calls.map((c) => c[0]), ["plan"]);
  assert.match(t.err.join("\n"), /Save your work.*--allow-tight/);
  assert.equal(t.err.at(-1), "nothing was started.");
});

test("too big and unknown arms are refused even with --allow-tight", async () => {
  const t = setup({ plan: [{ ...LOCAL, verdict: "too_big", reason: "Too big." }] });
  assert.equal(await run(t, ["--arm", "local-32k", "--arm", "zzz", "--allow-tight"]), 1);
  assert.equal(t.calls.length, 1);
  assert.equal(t.err.length, 3);
});

test("a start shows progress lines, then the table, and exits 0 when done", async () => {
  const t = setup({
    updates: [progress(0, "running"), progress(0, "completed"), progress(1, "running"), progress(1, "completed"), ended("done")],
  });
  assert.equal(await run(t, ["--arm", "local-32k", "--arm", "budget-cloud", "--model", "local-32k=x:1b"]), 0);
  assert.deepEqual(t.calls[1], [
    "start",
    { arms: ["local-32k", "budget-cloud"], models: { "local-32k": "x:1b" }, allow_tight: false },
  ]);
  const text = t.out.join("\n");
  assert.match(text, /^memory {2}qwen3.8:27b at 32K/m);
  assert.match(text, /^cost {4}budget-cloud: about \$0.38/m);
  assert.match(text, /started in the golem service as measurement 7f3a\. Ctrl-C leaves it running\./);
  assert.equal(t.out.filter((l) => l.startsWith("run ")).length, 4);
  assert.match(text, /measurement 7f3a · done in 1:00/);
  assert.equal(t.offs(), 1);
});

test("a stopped measurement exits 1 with the table and the way to resume", async () => {
  const t = setup({
    updates: [ended("stopped")],
    measurement: { ...DONE, state: "stopped", stop_reason: "Ollama stopped answering" },
  });
  assert.equal(await run(t, ["--arm", "local-32k"]), 1);
  assert.match(t.out.join("\n"), /stopped: Ollama stopped answering[\s\S]*resume 7f3a/);
});

test("Ctrl-C detaches, says the run goes on, exits 0 and does not stop it", async () => {
  const t = setup({ updates: [progress(0, "running")] });
  const done = run(t, ["--arm", "local-32k"]);
  await new Promise((r) => setTimeout(r, 5));
  t.press();
  assert.equal(await done, 0);
  const text = t.out.join("\n");
  assert.match(text, /goes on in the golem service/);
  assert.match(text, /golem eval helpers show 7f3a/);
  assert.match(text, /golem eval helpers stop 7f3a/);
  assert.equal(t.calls.some((c) => c[0] === "stop"), false);
  assert.equal(t.offs(), 1);
});

test("a refusal by the service is one line and exit 1", async () => {
  const t = setup({ startError: new Error("a measurement is already running") });
  assert.equal(await run(t, ["--arm", "local-32k"]), 1);
  assert.deepEqual(t.err, ["a measurement is already running"]);
});

test("resume plays the rest and follows it; a tight refusal gets the hint", async () => {
  const t = setup({ updates: [ended("done")] });
  assert.equal(await run(t, ["resume", "7f3a", "--allow-tight"]), 0);
  assert.deepEqual(t.calls[0], ["resume", { id: "7f3a", allowTight: true }]);
  const bad = setup({ startError: new Error("local-32k is tight on memory") });
  assert.equal(await run(bad, ["resume", "7f3a"]), 1);
  assert.match(bad.err[0] ?? "", /--allow-tight/);
});

test("stop with and without an id", async () => {
  const t = setup({ running: "7f3a" });
  assert.equal(await run(t, ["stop"]), 0);
  assert.deepEqual(t.calls.at(-1), ["stop", "7f3a"]);
  assert.match(t.out.join("\n"), /resume 7f3a/);
  const none = setup({});
  assert.equal(await run(none, ["stop"]), 1);
  assert.deepEqual(none.err, ["no measurement is running"]);
  assert.equal(await run(none, ["stop", "zz"]), 1);
  assert.equal(none.err.at(-1), "measurement zz is not running");
});

test("apply prints the numbers, or the errors with exit 1", async () => {
  const t = setup({});
  assert.equal(await run(t, ["apply", "7f3a"]), 0);
  assert.match(t.out.join("\n"), /read_share +0\.42\n.*fill_share +0\.8\n.*job_share +0\.1 +\(the default\)/);
  const bad = setup({});
  assert.equal(await run(bad, ["apply", "bad"]), 1);
  assert.deepEqual(bad.err, ["config.toml has a syntax error"]);
});

test("list, show and delete", async () => {
  const t = setup({});
  assert.equal(await run(t, ["list"]), 0);
  assert.match(t.out[0] ?? "", /no measurement yet/);
  assert.equal(await run(t, ["show", "7f3a"]), 0);
  assert.match(t.out.at(-1) ?? "", /measurement 7f3a/);
  assert.equal(await run(t, ["delete", "7f3a"]), 0);
  assert.equal(await run(t, ["delete", "nope"]), 1);
});
