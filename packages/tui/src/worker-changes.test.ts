import assert from "node:assert/strict";
import { test } from "node:test";

import { HELPER_CONFLICT, RpcError } from "@golem/client";
import { workerBlocks, workerFixture } from "@golem/view";

import { layoutChanges, openChangesManager, pressChanges, changesKeyOf, type ChangesData } from "./changes-manager.ts";
import type { Press } from "./keys.ts";
import {
  emptyWorkerPane,
  layoutWorkerBlocks,
  pressWorker,
  runWorkerCall,
  workerDone,
  workerKeyOf,
  WAIT_WORKER,
  type WorkerApi,
  type WorkerCall,
  type WorkerKey,
  type WorkerPane,
} from "./worker-changes.ts";

const press = (name: Press["name"], input = ""): Press => ({ name, input, ctrl: false, meta: false });
const blocks = () => workerBlocks(workerFixture(), { writes: () => true });
const focused: WorkerPane = { ...emptyWorkerPane, focus: true };

function at(index: number, key: WorkerKey, pane: WorkerPane = focused) {
  return pressWorker({ ...pane, index }, blocks(), key);
}

type Log = string[];
function fakeApi(log: Log, fail: Record<string, unknown> = {}): WorkerApi {
  const call = (name: string) => (sessionId: string, id: string) => {
    log.push(`${name} ${sessionId} ${id}`);
    return id in fail ? Promise.reject(fail[id]) : Promise.resolve({});
  };
  return {
    applyHelper: call("apply"),
    discardHelper: call("discard"),
    retryHelper: call("retry"),
    readArtifact: (sessionId, id) => {
      log.push(`read ${sessionId} ${id}`);
      return Promise.resolve({ text: "--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x\n+y\n" });
    },
  };
}

test("keys: v a A r x, and none clash with the file keys while the files have focus", () => {
  assert.equal(workerKeyOf(press(null, "v")), "view");
  assert.equal(workerKeyOf(press(null, "a")), "apply");
  assert.equal(workerKeyOf(press(null, "A")), "apply-green");
  assert.equal(workerKeyOf(press(null, "r")), "retry");
  assert.equal(workerKeyOf(press(null, "x")), "discard");
  assert.equal(workerKeyOf(press("tab")), "tab");
  assert.equal(workerKeyOf({ ...press("tab"), shift: true }), null);
  // The files keep `x`: the workers take it only once `tab` has moved the focus.
  assert.equal(changesKeyOf(press(null, "x")), "remove-note");
  const files = pressWorker(emptyWorkerPane, blocks(), "discard");
  assert.equal(files.pass, true);
  assert.equal(files.call, null);
});

test("tab moves the focus, up and down the selection", () => {
  const first = pressWorker(emptyWorkerPane, blocks(), "tab");
  assert.equal(first.pane.focus, true);
  const down = pressWorker(first.pane, blocks(), "down");
  assert.equal(down.pane.index, 1);
  assert.equal(pressWorker({ ...down.pane, index: 0 }, blocks(), "up").pane.index, 0);
  assert.equal(pressWorker(down.pane, blocks(), "tab").pane.focus, false);
  assert.equal(pressWorker(emptyWorkerPane, [], "tab").pass, true);
});

test("each key makes the right call for its block", () => {
  // h0 green, h1 green, h2 stopped, h3 failed, h4 running.
  assert.deepEqual(at(0, "apply").call, { kind: "apply", helperId: "h0" });
  assert.deepEqual(at(2, "retry").call, { kind: "retry", helperId: "h2" });
  assert.deepEqual(at(3, "discard").call, { kind: "discard", helperId: "h3" });
  assert.deepEqual(at(1, "apply-green").call, { kind: "apply-green", helperIds: ["h0", "h1"] });
  assert.deepEqual(at(3, "view").call, { kind: "view", helperId: "h3", label: "pydantic", artifactId: "a3" });
  // A key the block does not offer does nothing.
  assert.equal(at(0, "discard").call, null);
  assert.equal(at(2, "apply").call, null);
  assert.equal(at(4, "view").call, null);
  // A call in flight makes the next key wait.
  const busy = at(0, "apply", { ...focused, busy: true });
  assert.equal(busy.call, null);
  assert.equal(busy.pane.notes["h0"], WAIT_WORKER);
});

test("calls reach the client with the session and helper ids", async () => {
  const log: Log = [];
  const api = fakeApi(log);
  const calls: WorkerCall[] = [
    { kind: "apply", helperId: "h0" },
    { kind: "retry", helperId: "h2" },
    { kind: "discard", helperId: "h3" },
    { kind: "view", helperId: "h3", label: "pydantic", artifactId: "a3" },
  ];
  for (const call of calls) await runWorkerCall(api, "s1", call);
  assert.deepEqual(log, ["apply s1 h0", "retry s1 h2", "discard s1 h3", "read s1 a3"]);
});

test("a conflict is a notice with the path", async () => {
  const conflict = new RpcError(HELPER_CONFLICT, "conflict", { path: "src/a.py" });
  const result = await runWorkerCall(fakeApi([], { h0: conflict }), "s1", { kind: "apply", helperId: "h0" });
  assert.deepEqual(result.notes, [["h0", "src/a.py changed since the worker copied it"]]);
  const bare = await runWorkerCall(fakeApi([], { h0: new RpcError(HELPER_CONFLICT, "conflict") }), "s1", { kind: "apply", helperId: "h0" });
  assert.deepEqual(bare.notes, [["h0", "A file changed since the worker copied it"]]);
  const other = await runWorkerCall(fakeApi([], { h0: new Error("boom") }), "s1", { kind: "apply", helperId: "h0" });
  assert.deepEqual(other.notes, [["h0", "boom"]]);
  const rows = layoutWorkerBlocks(blocks(), workerDone({ ...focused, busy: true }, result), "~/app", 80).map((row) => row.text);
  assert.ok(rows.includes("    src/a.py changed since the worker copied it"));
});

test("apply green goes in order and stops at the first conflict", async () => {
  const log: Log = [];
  const all = await runWorkerCall(fakeApi(log), "s1", { kind: "apply-green", helperIds: ["h0", "h1"] });
  assert.deepEqual(log, ["apply s1 h0", "apply s1 h1"]);
  assert.deepEqual(all.notes, []);

  const stopped: Log = [];
  const conflict = new RpcError(HELPER_CONFLICT, "conflict", { path: "b.py" });
  const result = await runWorkerCall(fakeApi(stopped, { h0: conflict }), "s1", { kind: "apply-green", helperIds: ["h0", "h1"] });
  assert.deepEqual(stopped, ["apply s1 h0"]);
  assert.deepEqual(result.notes, [["h0", "b.py changed since the worker copied it"]]);
});

test("view opens the diff and fills it when the artifact is read", async () => {
  const opened = at(3, "view");
  assert.equal(opened.pane.view?.text, null);
  assert.equal(opened.pane.busy, false);
  const result = await runWorkerCall(fakeApi([]), "s1", opened.call as WorkerCall);
  const filled = workerDone(opened.pane, result);
  assert.match(filled.view?.text ?? "", /\+y/);
  // Esc closes the diff, and a second one falls through to the Changes view.
  const closed = pressWorker(filled, blocks(), "back");
  assert.equal(closed.pane.view, null);
  assert.equal(closed.pass, false);
  assert.equal(pressWorker(closed.pane, blocks(), "back").pass, true);
});

test("the fixture renders: label, status, stat, checks line, footer", () => {
  const rows = layoutWorkerBlocks(blocks(), focused, "~/app", 100).map((row) => row.text);
  assert.deepEqual(rows, [
    "› httpx · checks pass · 2 files +38 −12",
    "    tests pass",
    "  aiohttp · checks pass · 1 file +5 −1",
    "    tests pass",
    "  sqlmodel · stopped · 1 file +20 −4",
    "    stopped: 25 calls · tests fail",
    "  pydantic · checks fail · 1 file +7 −7",
    "    tests and lint fail",
    "  trio · working",
    "in copies · nothing in ~/app has changed · A apply the 2 green",
  ]);
});

test("the Changes view draws the blocks above the files, and the diff in their place", () => {
  const data: ChangesData = { files: [], error: null, diffs: {}, workers: { blocks: blocks(), folder: "~/app" } };
  const state = openChangesManager();
  const lines = layoutChanges(state, data, 80, 20).map((line) => line.text);
  assert.equal(lines[1], "  httpx · checks pass · 2 files +38 −12");
  assert.ok(lines.includes("No changes yet."));
  assert.equal(lines[19], "tab workers · esc back");

  const keyed = pressWorker(emptyWorkerPane, blocks(), "tab").pane;
  const focusedLines = layoutChanges({ ...state, workers: keyed }, data, 120, 20).map((line) => line.text);
  assert.match(focusedLines[19] ?? "", /^↑↓ worker · v view · a apply · A apply green/);

  const viewing = at(3, "view", keyed).pane;
  const filled = workerDone(viewing, { notes: [], viewed: { helperId: "h3", text: "--- a/e.py\n+++ b/e.py\n@@ -1 +1 @@\n-1\n+2\n", error: null } });
  const shown = layoutChanges({ ...state, workers: filled }, data, 80, 20).map((line) => line.text);
  assert.equal(shown[0], "changes · pydantic");
  assert.ok(shown.includes("+2"));
  assert.equal(shown[19], "↑↓ PgUp/Dn scroll · esc back to the workers");
});

test("no blocks changes nothing in the Changes view", () => {
  const data: ChangesData = { files: [], error: null, diffs: {} };
  const lines = layoutChanges(openChangesManager(), data, 80, 6).map((line) => line.text);
  assert.deepEqual(lines, ["changes", "No changes yet.", "", "", "", "esc back"]);
  assert.equal(pressChanges(openChangesManager(), data, "back").action.kind, "close");
});
