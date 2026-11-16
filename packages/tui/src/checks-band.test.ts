import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage, CheckRun, ChecksState } from "@golem/view";

import { CHECKS_KEYS, checksBandText } from "./checks-band.ts";
import { frameBudget } from "./chrome.ts";
import { applyComposer, closedDebug } from "./commands.ts";
import { pressKey, type KeyPlace } from "./keys.ts";
import { layoutMessages, type Span } from "./layout-chat.ts";

const offered = [
  { name: "ruff", command: "ruff check ." },
  { name: "tsc", command: "pnpm run typecheck" },
];

test("the band asks the question, names the commands, and shows the keys", () => {
  assert.equal(
    checksBandText(offered, 120),
    "Run checks after golem edits? ruff check . · pnpm run typecheck  y run them · n not in this chat",
  );
  assert.equal(CHECKS_KEYS, "y run them · n not in this chat");
});

test("a narrow window cuts the commands, never the keys", () => {
  const text = checksBandText(offered, 70);
  assert.ok(text.length <= 70);
  assert.ok(text.endsWith(CHECKS_KEYS));
  assert.ok(text.includes("…"));
});

function place(overrides: Partial<KeyPlace> = {}): KeyPlace {
  return {
    overlay: false,
    help: false,
    switcher: false,
    switcherConfirm: false,
    switcherFiltering: false,
    debug: false,
    draftEmpty: true,
    busy: false,
    connected: true,
    suggestions: false,
    history: false,
    ...overrides,
  };
}

test("while golem asks about checks, y runs them and n does not, with no draft", () => {
  const press = (where: KeyPlace, input: string) => pressKey(where, { name: null, input, ctrl: false, meta: false });
  assert.deepEqual(press(place({ question: true }), "y"), { kind: "checks", on: true });
  assert.deepEqual(press(place({ question: true }), "n"), { kind: "checks", on: false });
  // A draft keeps its letters, and so does a chat with no question.
  assert.deepEqual(press(place({ question: true, draftEmpty: false }), "y"), { kind: "insert", text: "y" });
  assert.deepEqual(press(place(), "n"), { kind: "insert", text: "n" });
  // An approval takes the keys first.
  assert.notDeepEqual(press(place({ question: true, approval: true, busy: true }), "y"), { kind: "checks", on: true });
});

test("the checks question takes one row, and gives it up before the composer is cut", () => {
  const room = frameBudget({ rows: 30, columns: 80, draft: "", busy: false, banner: false, checks: 1 });
  assert.equal(room.checks, 1);
  const none = frameBudget({ rows: 30, columns: 80, draft: "", busy: false, banner: false });
  assert.equal(none.checks, 0);
  assert.equal(room.body, none.body - 1);
  const tight = frameBudget({ rows: 3, columns: 80, draft: "", busy: false, banner: false, checks: 1 });
  assert.equal(tight.checks, 0);
  assert.ok(tight.body >= 1);
});

test("/checks on and /checks off set the session's answer", () => {
  assert.deepEqual(applyComposer(closedDebug, "/checks on"), { kind: "checks", on: true });
  assert.deepEqual(applyComposer(closedDebug, "/checks off"), { kind: "checks", on: false });
  assert.equal(applyComposer(closedDebug, "/checks").kind, "unknown");
});

function text(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join("");
}

function checksFor(...runs: Array<Partial<CheckRun> & Pick<CheckRun, "checkId" | "name">>): ChecksState {
  return {
    turns: [
      {
        runId: "r1",
        runs: runs.map((run) => ({
          command: "cmd",
          round: 0,
          status: "passed" as const,
          exitCode: 0,
          durationMs: 1000,
          output: "",
          artifactId: null,
          ...run,
        })),
      },
    ],
    offered: null,
    allowed: true,
  };
}

function checkRows(checks: ChecksState, runId: string | null = null): { text: string; spans: readonly Span[] }[] {
  const reply: ChatMessage = { id: "a", role: "assistant", text: "Done.", streaming: false, runId: "r1" };
  return layoutMessages([reply], 80, { times: false, now: 0, checks, runId })
    .filter((line) => line.spans.some((span) => /^[◐●]/.test(span.text) || span.text.startsWith("  │")))
    .map((line) => ({ text: text(line.spans), spans: line.spans }));
}

test("a running check is a row with a yellow half circle", () => {
  const rows = checkRows(
    checksFor({ checkId: "k1", name: "ruff" }, { checkId: "k2", name: "tsc", status: "running", durationMs: null }),
    "r1",
  );
  assert.deepEqual(rows.map((row) => row.text), ["◐ check ruff ✓ · tsc running"]);
  assert.equal(rows[0]?.spans[0]?.warn, true);
});

test("passed checks are a row with a green dot and the total time", () => {
  const rows = checkRows(
    checksFor({ checkId: "k1", name: "ruff", durationMs: 2200 }, { checkId: "k2", name: "tsc", durationMs: 4000 }),
  );
  assert.deepEqual(rows.map((row) => row.text), ["● check ruff ✓ · tsc ✓ · 6.2s"]);
  assert.equal(rows[0]?.spans[0]?.color, "green");
});

test("a failed check is red with the end of its output, six rows at most, and says it is fixing", () => {
  const output = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n");
  const rows = checkRows(checksFor({ checkId: "k1", name: "ruff", status: "failed", exitCode: 1, output }), "r1");
  assert.deepEqual(
    rows.map((row) => row.text),
    ["● check ruff ✗ · fixing, round 1", "  │ three", "  │ four", "  │ five", "  │ six", "  │ seven", "  │ eight"],
  );
  assert.equal(rows[0]?.spans[0]?.color, "red");
  assert.equal(rows[1]?.spans[0]?.dim, true);
});

test("a failure after the last round says how many rounds it had", () => {
  const rows = checkRows(
    checksFor(
      { checkId: "k1", name: "ruff", status: "failed", round: 0, output: "x" },
      { checkId: "k2", name: "ruff", status: "failed", round: 1, output: "y" },
    ),
  );
  assert.deepEqual(rows.map((row) => row.text), ["● check ruff ✗ · still failing after 1 round", "  │ y"]);
});

test("the checks sit under the last reply of their run, once, and only when given", () => {
  const checks = checksFor({ checkId: "k1", name: "ruff" });
  const first: ChatMessage = { id: "a", role: "assistant", text: "Editing.", streaming: false, runId: "r1" };
  const last: ChatMessage = { id: "b", role: "assistant", text: "Done.", streaming: false, runId: "r1" };
  const rows = layoutMessages([first, last], 80, { times: false, now: 0, checks }).map((line) => text(line.spans));
  assert.equal(rows.filter((row) => row.startsWith("● check")).length, 1);
  assert.ok(rows.indexOf("● check ruff ✓ · 1.0s") > rows.indexOf("Done."));
  const plain = layoutMessages([first, last], 80, { times: false, now: 0 }).map((line) => text(line.spans));
  assert.deepEqual(plain.filter((row) => row.includes("check")), []);
});
