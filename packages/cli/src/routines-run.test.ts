import assert from "node:assert/strict";
import { test } from "node:test";

import type { RoutineInfo, RoutineRunSummary } from "@golem/client";

import {
  firstRoutineLine,
  parseRoutinesArgs,
  runRoutinesEdit,
  runRoutinesList,
  runRoutinesPause,
  runRoutinesRun,
  type RoutinesClient,
  type RoutinesDeps,
} from "./routines-run.ts";

const info: RoutineInfo = { config: { name: "morning-brief", prompt: "p", schedule: "daily 08:30" }, path: "/h/config.toml", source: "user" };

function run(status: RoutineRunSummary["status"], rest: Partial<RoutineRunSummary> = {}): RoutineRunSummary {
  return { routine: "morning-brief", routine_run_id: "r1", scope: "user", trigger: "manual", status, ...rest };
}

/** A daemon with one routine; `statuses` are what `routine.get` shows on each look. */
function fake(statuses: RoutineRunSummary[] = []) {
  const calls: string[] = [];
  let looks = 0;
  const unknown = (name: string): Error => new Error(`there is no routine called ${name}`);
  const client: RoutinesClient = {
    listRoutines: async (folders) => {
      calls.push(`list ${JSON.stringify(folders)}`);
      return { routines: [info], issues: [] };
    },
    getRoutine: async (name, folder) => {
      calls.push(`get ${name} ${folder ?? ""}`.trim());
      const shown = statuses[Math.min(looks, statuses.length - 1)];
      looks += 1;
      return { routine: info, runs: shown === undefined ? [] : [shown] };
    },
    runRoutine: async (name, folder) => {
      calls.push(`run ${name} ${folder ?? ""}`.trim());
      if (name !== "morning-brief") throw unknown(name);
      return { routine_run_id: "r1", session_id: "s1" };
    },
    updateRoutine: async (name, fields) => {
      calls.push(`update ${name} ${JSON.stringify(fields)}`);
      if (name !== "morning-brief") throw unknown(name);
      return { routine: info };
    },
  };
  return { client, calls };
}

function setup(overrides: Partial<RoutinesDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: Array<[string, number | undefined]> = [];
  const deps: RoutinesDeps = {
    cwd: "/work/proj",
    now: () => new Date(2026, 10, 17, 9, 0),
    configPath: "/h/config.toml",
    editFile: async (path, line) => {
      opened.push([path, line]);
      return true;
    },
    readFile: () => 'name = "x"\n\n[[routine]]\nname = "a"\n',
    sleep: async () => undefined,
    write: (line) => out.push(line),
    error: (line) => err.push(line),
    ...overrides,
  };
  return { deps, out, err, opened };
}

test("the arguments parse, and the ones that do not fit are errors", () => {
  assert.deepEqual(parseRoutinesArgs([], "/w"), { kind: "list" });
  assert.deepEqual(parseRoutinesArgs(["list"], "/w"), { kind: "list" });
  assert.deepEqual(parseRoutinesArgs(["run", "brief", "--wait"], "/w"), { kind: "run", name: "brief", wait: true });
  assert.deepEqual(parseRoutinesArgs(["run", "brief", "--folder", "p"], "/w"), { kind: "run", name: "brief", folder: "/w/p", wait: false });
  assert.deepEqual(parseRoutinesArgs(["pause", "brief"], "/w"), { kind: "pause", name: "brief" });
  assert.deepEqual(parseRoutinesArgs(["resume", "brief"], "/w"), { kind: "resume", name: "brief" });
  assert.deepEqual(parseRoutinesArgs(["edit"], "/w"), { kind: "edit" });
  for (const bad of [["run"], ["run", "a", "b"], ["run", "a", "--x"], ["pause"], ["list", "x"], ["edit", "x"], ["nope"]]) {
    assert.equal(parseRoutinesArgs(bad, "/w").kind, "error", bad.join(" "));
  }
  const all = parseRoutinesArgs(["pause", "--all"], "/w");
  assert.equal(all.kind === "error" && /not offered yet/.test(all.message), true);
});

test("list prints the routines and the files that did not parse", async () => {
  const { client, calls } = fake();
  const { deps, out, err } = setup();
  assert.equal(await runRoutinesList(client, deps), 0);
  assert.deepEqual(calls, ['list ["/work/proj"]']);
  assert.match(out.join("\n"), /^morning-brief {2}every day at 08:30 {2}- {2}never run$/);
  assert.deepEqual(err, []);
  const bad: RoutinesClient = { ...client, listRoutines: async () => ({ routines: [], issues: [{ file: "/h/config.toml", line: 4, message: "bad schedule" }] }) };
  const second = setup();
  assert.equal(await runRoutinesList(bad, second.deps), 0);
  assert.deepEqual(second.err, ["/h/config.toml:4: bad schedule"]);
});

test("run prints the session id", async () => {
  const { client, calls } = fake();
  const { deps, out } = setup();
  assert.equal(await runRoutinesRun(client, { name: "morning-brief", wait: false }, deps), 0);
  assert.deepEqual(out, ["s1"]);
  assert.deepEqual(calls, ["run morning-brief"]);
});

test("run --wait waits for the firing and prints its summary", async () => {
  const { client, calls } = fake([run("queued"), run("running"), run("succeeded", { summary: "Three meetings today.\n" })]);
  const slept: number[] = [];
  const { deps, out, err } = setup({ sleep: async (ms) => void slept.push(ms) });
  assert.equal(await runRoutinesRun(client, { name: "morning-brief", folder: "/r", wait: true }, deps), 0);
  assert.deepEqual(out, ["Three meetings today."]);
  assert.deepEqual(err, ["session: s1"]);
  assert.equal(slept.length, 2);
  assert.deepEqual(calls, ["run morning-brief /r", "get morning-brief /r", "get morning-brief /r", "get morning-brief /r"]);
});

test("run --wait says why a firing failed or was skipped, and where an approval waits", async () => {
  const failed = setup();
  assert.equal(await runRoutinesRun(fake([run("failed", { reason: "model unreachable" })]).client, { name: "morning-brief", wait: true }, failed.deps), 1);
  assert.equal(failed.err.at(-1), "morning-brief failed: model unreachable");
  const skipped = setup();
  assert.equal(await runRoutinesRun(fake([run("skipped", { reason: "already running" })]).client, { name: "morning-brief", wait: true }, skipped.deps), 1);
  assert.equal(skipped.err.at(-1), "morning-brief skipped: already running");
  const waiting = setup();
  assert.equal(await runRoutinesRun(fake([run("waiting")]).client, { name: "morning-brief", wait: true }, waiting.deps), 3);
  assert.match(waiting.err.join("\n"), /golem open s1/);
});

test("an unknown name is the daemon's message and exit 1", async () => {
  const { client } = fake();
  const { deps, out, err } = setup();
  assert.equal(await runRoutinesRun(client, { name: "nope", wait: true }, deps), 1);
  assert.equal(await runRoutinesPause(client, "nope", true, deps), 1);
  assert.deepEqual(out, []);
  assert.deepEqual(err, ["there is no routine called nope", "there is no routine called nope"]);
});

test("pause writes enabled = false and resume writes true", async () => {
  const { client, calls } = fake();
  const { deps, out } = setup();
  assert.equal(await runRoutinesPause(client, "morning-brief", true, deps), 0);
  assert.equal(await runRoutinesPause(client, "morning-brief", false, deps), 0);
  assert.deepEqual(calls, ['update morning-brief {"enabled":false}', 'update morning-brief {"enabled":true}']);
  assert.deepEqual(out, ["paused morning-brief", "resumed morning-brief"]);
});

test("edit opens the file at the first [[routine]], then reports the check", async () => {
  assert.equal(firstRoutineLine("a = 1\n\n [[routine]]\n"), 3);
  assert.equal(firstRoutineLine("a = 1\n"), null);
  const good = setup();
  assert.equal(await runRoutinesEdit(fake().client, good.deps), 0);
  assert.deepEqual(good.opened, [["/h/config.toml", 3]]);
  assert.equal(good.out[0], "/h/config.toml is fine: 1 routine");

  const { client } = fake();
  const bad: RoutinesClient = {
    ...client,
    listRoutines: async () => ({ routines: [], issues: [{ file: "/h/config.toml", line: 7, message: "schedule: not a schedule" }] }),
  };
  const broken = setup({ readFile: () => null });
  assert.equal(await runRoutinesEdit(bad, broken.deps), 1);
  assert.deepEqual(broken.opened, [["/h/config.toml", undefined]]);
  assert.equal(broken.err[0], "/h/config.toml:7: schedule: not a schedule");

  const failed = setup({ editFile: async () => false });
  assert.equal(await runRoutinesEdit(fake().client, failed.deps), 1);
  assert.match(failed.err[0] ?? "", /the editor did not finish/);
});
