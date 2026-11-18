import assert from "node:assert/strict";
import { test } from "node:test";

import type { RoutineInfo, RoutineRunSummary } from "@golem/client";
import { formatDuration, lastResultText, routineHeadline, routineRowLine, runWhenText } from "@golem/view";

import type { Press } from "./keys.ts";

import {
  closedRoutinesManager,
  layoutRoutinesManager,
  openRoutinesManager,
  orderedRoutines,
  pressRoutinesManager,
  routineChoices,
  routineKey,
  routineLineOf,
  routineMark,
  routinesManagerKeyOf,
  type RoutineList,
  type RoutinesManagerKey,
  type RoutinesManagerState,
} from "./routines-manager.ts";

const NOW = Date.parse("2026-11-18T10:00:00Z");
const HOME = "/Users/me";
const at = (hours: number): string => new Date(NOW + hours * 3_600_000).toISOString();

function run(status: RoutineRunSummary["status"], extra: Partial<RoutineRunSummary> = {}): RoutineRunSummary {
  return { routine: "x", routine_run_id: `run-${status}`, scope: "user", status, trigger: "schedule", ...extra };
}

function routine(name: string, extra: Partial<RoutineInfo> = {}, config: Partial<RoutineInfo["config"]> = {}): RoutineInfo {
  return {
    config: { name, prompt: `Do ${name}\nand more`, schedule: "weekdays 08:30", ...config },
    path: "/Users/me/.golem/config.toml",
    source: "user",
    ...extra,
  };
}

const brief = routine("morning-brief", { next_at: at(14), last: run("succeeded", { session_id: "s-brief" }) });
const triage = routine("sentry-triage", { last: run("waiting", { session_id: "s-triage" }) }, { schedule: "every 15m" });
const receipts = routine("receipts", {}, { schedule: null, on: { watch: "~/Downloads", glob: "*.pdf" } });
const report = routine("dep-report", {}, { enabled: false });
const broken = routine("release-check", { last: run("failed", { reason: "mcp github: not connected" }) });
const proj = routine("lint", { source: "project", folder: "/Users/me/app", path: "/Users/me/app/.golem/config.toml" });
const ROUTINES = [proj, brief, triage, receipts, report, broken];
const LIST: RoutineList = { routines: ROUTINES, issues: [], error: null };

function press(state: RoutinesManagerState, ...keys: RoutinesManagerKey[]) {
  let current = state;
  let action: ReturnType<typeof pressRoutinesManager>["action"] = { kind: "none" };
  for (const key of keys) {
    ({ state: current, action } = pressRoutinesManager(current, ROUTINES, key));
  }
  return { state: current, action };
}

function shown(
  state: RoutinesManagerState,
  list: RoutineList = LIST,
  runs: readonly RoutineRunSummary[] | null = null,
  rows = 40,
): string[] {
  return layoutRoutinesManager({ state, list, runs, now: NOW, home: HOME, columns: 100, rows }).map(
    (line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`,
  );
}

test("keys: arrows, Enter, Esc, digits, and r, p, e", () => {
  const key = (name: Press["name"], input = "") => routinesManagerKeyOf({ name, input, ctrl: false, meta: false });
  assert.equal(key("down"), "down");
  assert.equal(key("return"), "enter");
  assert.equal(key("escape"), "back");
  assert.equal(key(null, "2"), 2);
  assert.equal(key(null, "r"), "run");
  assert.equal(key(null, "p"), "pause");
  assert.equal(key(null, "e"), "edit");
  assert.equal(key(null, "x"), null);
  assert.equal(routinesManagerKeyOf({ name: null, input: "r", ctrl: true, meta: false }), null);
});

test("marks: ✔ last ok, ✘ last failed, ! waiting, ○ paused or never ran", () => {
  assert.deepEqual(routineMark(brief), { text: "✔", tone: "ok" });
  assert.deepEqual(routineMark(broken), { text: "✘", tone: "bad" });
  assert.deepEqual(routineMark(triage), { text: "!", tone: "wait" });
  assert.deepEqual(routineMark(receipts), { text: "○", tone: "off" });
  assert.deepEqual(routineMark(report), { text: "○", tone: "off" });
  assert.deepEqual(routineMark(routine("a", { paused: true, last: run("failed") })), { text: "○", tone: "off" });
  assert.deepEqual(routineMark(routine("b", { last: run("skipped") })), { text: "○", tone: "off" });
});

test("the list says what is next, yours first, then the project's", () => {
  assert.deepEqual(
    orderedRoutines(ROUTINES).map((item) => item.config.name),
    ["morning-brief", "sentry-triage", "receipts", "dep-report", "release-check", "lint"],
  );
  const lines = shown(openRoutinesManager());
  const width = "release-check".length;
  assert.deepEqual(lines, [
    "Routines",
    "6 routines · next: morning-brief in 14 h",
    `❯ ✔ ${"morning-brief".padEnd(width)}  ${routineRowLine(brief, NOW)}`,
    `  ! ${"sentry-triage".padEnd(width)}  ${routineRowLine(triage, NOW)}`,
    `  ○ ${"receipts".padEnd(width)}  ${routineRowLine(receipts, NOW)}`,
    `  ○ ${"dep-report".padEnd(width)}  ${routineRowLine(report, NOW)}`,
    `  ✘ ${"release-check".padEnd(width)}  ${routineRowLine(broken, NOW)}`,
    `  ○ ${"lint".padEnd(width)}  ${routineRowLine(proj, NOW)}`,
    "",
    "↑/↓ to navigate · Enter to open · r run now · p pause · e edit · Esc to close",
  ]);
  assert.ok(routineRowLine(triage, NOW).endsWith("needs you"));
  assert.ok(routineRowLine(report, NOW).endsWith("off"));
});

test("a paused routine is a dim row, and the pointer follows the arrows", () => {
  const lines = layoutRoutinesManager({
    state: { open: true, view: { kind: "list", selected: 3 } },
    list: LIST,
    runs: null,
    now: NOW,
    home: HOME,
    columns: 100,
    rows: 40,
  });
  const row = lines.find((line) => line.text.startsWith("dep-report"));
  assert.equal(row?.prefix, "❯ ");
  assert.equal(row?.selected, true);
  const dim = lines.find((line) => line.text.startsWith("receipts"));
  assert.equal(dim?.dim, false);
  assert.equal(lines.find((line) => line.text.startsWith("morning-brief"))?.dim, false);
  const moved = press(openRoutinesManager(), "down", "down", "down").state;
  assert.deepEqual(moved.view, { kind: "list", selected: 3 });
  assert.deepEqual(press(openRoutinesManager(), "up").state.view, { kind: "list", selected: 0 });
  assert.deepEqual(press(openRoutinesManager(), ...Array<RoutinesManagerKey>(20).fill("down")).state.view, {
    kind: "list",
    selected: 5,
  });
});

test("no routines, an error, a wait, and files that did not parse", () => {
  assert.deepEqual(shown(openRoutinesManager(), { routines: [], issues: [], error: null }).slice(0, 4), [
    "Routines",
    "no routines",
    "",
    "Add one with golem routines edit, or make one in the web page.",
  ]);
  assert.deepEqual(shown(openRoutinesManager(), { routines: null, issues: [], error: "daemon is down" }).slice(0, 3), [
    "Routines",
    "",
    "daemon is down",
  ]);
  assert.equal(shown(openRoutinesManager(), { routines: null, issues: [], error: null })[2], "asking the daemon…");
  const lines = shown(openRoutinesManager(), {
    routines: [brief],
    issues: [{ file: "/Users/me/.golem/config.toml", line: 12, message: "schedule: not a schedule" }],
    error: null,
  });
  assert.ok(lines.includes("✘ /Users/me/.golem/config.toml:12: schedule: not a schedule"));
});

test("Enter opens the detail and asks for the last runs", () => {
  const opened = press(openRoutinesManager(), "enter");
  assert.deepEqual(opened.state.view, { kind: "detail", key: routineKey(brief), selected: 0 });
  assert.deepEqual(opened.action, { kind: "load-runs", name: "morning-brief", folder: null });
  const lint = press(openRoutinesManager(), "enter");
  assert.equal(lint.action.kind, "load-runs");
  const project = press({ open: true, view: { kind: "list", selected: 5 } }, "enter");
  assert.deepEqual(project.action, { kind: "load-runs", name: "lint", folder: "/Users/me/app" });
});

test("the detail shows the facts, the last runs, and the numbered actions", () => {
  const full = routine("morning-brief", {
    next_at: at(14),
    last: run("succeeded", { session_id: "s-brief" }),
  }, { folder: "/Users/me/repo", model: "claude-sonnet-5-5", mcp: ["github", "linear"] });
  const runs = [
    run("succeeded", { started_at: "2026-11-18T08:30:00", ended_at: "2026-11-18T08:32:14", summary: "5 PRs" }),
    run("failed", { started_at: "2026-11-17T08:30:00", ended_at: "2026-11-17T08:30:02", reason: "mcp github: not connected" }),
    run("skipped", { started_at: "2026-11-16T08:30:00", reason: "paused" }),
    run("succeeded", { started_at: "2026-11-15T08:30:00" }),
  ];
  const lines = shown(
    { open: true, view: { kind: "detail", key: routineKey(full), selected: 1 } },
    { routines: [full], issues: [], error: null },
    runs,
  );
  const first = runs[0] as RoutineRunSummary;
  assert.deepEqual(lines, [
    "morning-brief routine",
    "",
    "Status:   ✔ scheduled",
    `Trigger:  ${routineHeadline(full, NOW)}`,
    "Prompt:   Do morning-brief",
    "Folder:   ~/repo",
    "Model:    claude-sonnet-5-5",
    "MCP:      github, linear",
    "Config:   ~/.golem/config.toml · [[routine]] morning-brief",
    "",
    "Last runs:",
    `  ✔ ${runWhenText(first.started_at, NOW)}  ${formatDuration(134_000)}  ${lastResultText(first)}`,
    `  ✘ ${runWhenText(runs[1]?.started_at, NOW)}  ${formatDuration(2_000)}  mcp github: not connected`,
    `  ○ ${runWhenText(runs[2]?.started_at, NOW)}  skipped: paused`,
    "",
    "  1. Run now",
    "❯ 2. Pause",
    "  3. Edit in $EDITOR",
    "  4. Open the last run",
    "",
    "↑/↓ to navigate · Enter to select · Esc to go back",
  ]);
  assert.equal(shown({ open: true, view: { kind: "detail", key: routineKey(full), selected: 0 } }, { routines: [full], issues: [], error: null }, null)[11], "  asking the daemon…");
  assert.equal(shown({ open: true, view: { kind: "detail", key: routineKey(full), selected: 0 } }, { routines: [full], issues: [], error: null }, [])[11], "  no runs yet");
});

test("a watch routine's detail says what it watches and which file each run was for", () => {
  const watched = routine("receipts", {}, { schedule: null, on: { watch: "~/Downloads", glob: "*.pdf" } });
  const runs = [run("succeeded", { trigger: "watch", started_at: "2026-11-18T08:30:00", ended_at: "2026-11-18T08:30:20", summary: "filed", watch_path: "/Users/me/Downloads/invoice 2026-11.pdf" })];
  const lines = shown({ open: true, view: { kind: "detail", key: routineKey(watched), selected: 0 } }, { routines: [watched], issues: [], error: null }, runs);
  assert.equal(lines[2], "Status:   ○ watching");
  assert.equal(lines[3], "Trigger:  New *.pdf in ~/Downloads");
  assert.ok(lines.includes(`  ✔ ${runWhenText(runs[0]?.started_at, NOW)}  invoice 2026-11.pdf  ${formatDuration(20_000)}  filed`));
});

test("the detail's actions: Run now, Pause or Resume, Edit in $EDITOR, Open the last run", () => {
  assert.deepEqual(
    routineChoices(brief).map((choice) => choice.label),
    ["Run now", "Pause", "Edit in $EDITOR", "Open the last run"],
  );
  assert.equal(routineChoices(report)[1]?.label, "Resume");
  const detail = (name: string): RoutinesManagerState => {
    const items = orderedRoutines(ROUTINES);
    const index = items.findIndex((item) => item.config.name === name);
    return press(openRoutinesManager(), ...Array<RoutinesManagerKey>(index).fill("down"), "enter").state;
  };
  assert.deepEqual(press(detail("morning-brief"), 1).action, { kind: "run", name: "morning-brief", folder: null });
  assert.deepEqual(press(detail("morning-brief"), 2).action, { kind: "set-paused", name: "morning-brief", paused: true });
  assert.deepEqual(press(detail("dep-report"), 2).action, { kind: "set-paused", name: "dep-report", paused: false });
  assert.deepEqual(press(detail("morning-brief"), 3).action, {
    kind: "edit",
    path: "/Users/me/.golem/config.toml",
    name: "morning-brief",
  });
  assert.deepEqual(press(detail("morning-brief"), 4).action, { kind: "open-run", sessionId: "s-brief" });
  assert.deepEqual(press(detail("sentry-triage"), 4).action, { kind: "open-run", sessionId: "s-triage" });
  assert.equal(press(detail("receipts"), 4).action.kind, "notice");
  assert.equal(press(detail("morning-brief"), 5).action.kind, "none");
  assert.equal(press(detail("lint"), 2).action.kind, "notice");
  assert.deepEqual(press(detail("lint"), 1).action, { kind: "run", name: "lint", folder: "/Users/me/app" });
  // Enter runs the choice under the pointer.
  assert.equal(press(detail("morning-brief"), "down", "down", "enter").action.kind, "edit");
  assert.deepEqual(press(detail("morning-brief"), "back").state.view, { kind: "list", selected: 0 });
});

test("r, p and e act on the routine in the list", () => {
  assert.deepEqual(press(openRoutinesManager(), "run").action, { kind: "run", name: "morning-brief", folder: null });
  assert.deepEqual(press(openRoutinesManager(), "pause").action, { kind: "set-paused", name: "morning-brief", paused: true });
  assert.equal(press(openRoutinesManager(), "edit").action.kind, "edit");
  assert.deepEqual(press(openRoutinesManager(), "down", "down", "down", "pause").action, {
    kind: "set-paused",
    name: "dep-report",
    paused: false,
  });
});

test("Esc goes back, then closes", () => {
  const detail = press(openRoutinesManager(), "enter").state;
  assert.equal(press(detail, "back").state.open, true);
  const closed = press(openRoutinesManager(), "back");
  assert.deepEqual(closed.state, closedRoutinesManager);
  assert.deepEqual(closed.action, { kind: "close" });
});

test("a long list scrolls to keep the pointer on screen, and the hint stays", () => {
  const many = Array.from({ length: 30 }, (_, index) => routine(`r${String(index).padStart(2, "0")}`));
  const state: RoutinesManagerState = { open: true, view: { kind: "list", selected: 25 } };
  const lines = shown(state, { routines: many, issues: [], error: null }, null, 10);
  assert.equal(lines.length, 10);
  assert.ok(lines.some((line) => line.startsWith("❯ ") && line.includes("r25")));
  assert.equal(lines.at(-1), "↑/↓ to navigate · Enter to open · r run now · p pause · e edit · Esc to close");
});

test("a line is cut to the width", () => {
  const lines = layoutRoutinesManager({
    state: openRoutinesManager(),
    list: LIST,
    runs: null,
    now: NOW,
    home: HOME,
    columns: 30,
    rows: 40,
  });
  for (const line of lines) {
    assert.ok((line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0) + line.text.length <= 30);
  }
});

test("the editor opens at the routine's own [[routine]]", () => {
  const text = [
    "[model]",
    'name = "x"',
    "",
    "[[routine]]",
    'name = "first"',
    'prompt = "a"',
    "",
    "[[routine]]",
    'prompt = "b"',
    'name = "second"  # the one',
    "",
    "[mcp.s]",
    'name = "second"',
  ].join("\n");
  assert.equal(routineLineOf(text, "first"), 4);
  assert.equal(routineLineOf(text, "second"), 8);
  assert.equal(routineLineOf(text, "gone"), 4);
  assert.equal(routineLineOf('name = "second"', "second"), null);
  assert.equal(routineLineOf('[[routine]]\nname = "a.b"', "a.b"), 1);
  assert.equal(routineLineOf('[[routine]]\nname = "axb"', "a.b"), 1);
});
