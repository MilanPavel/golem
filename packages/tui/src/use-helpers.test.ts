import assert from "node:assert/strict";
import { test } from "node:test";

import type { PendingApproval } from "@golem/view";

import { approvalLines, approvalRows, APPROVAL_ROWS } from "./approval.ts";
import { layoutAgentsManager, nextUseHelpers, openAgentsManager, pressAgentsManager, useHelpersFailed, USE_HELPERS_UNKNOWN } from "./agents-manager.ts";
import { helperAskLines, helperDock } from "./helper-ask.ts";
import { pressKey, type KeyPlace } from "./keys.ts";

const KEEP = { keep_days: 7, keep_problem_days: 30 };

function setting(use_helpers: "when_needed" | "ask" | "never" | undefined, columns = 100): string[] {
  return layoutAgentsManager({
    state: openAgentsManager(),
    agents: [],
    error: null,
    cwd: "/w",
    home: "/h",
    columns,
    rows: 40,
    keep: { ...KEEP, ...(use_helpers === undefined ? {} : { use_helpers }) },
  }).map((line) => line.text);
}

test("the list shows Use helpers in each position, with what it does", () => {
  const when = setting("when_needed", 200);
  assert.ok(when.includes("use helpers: When needed (u changes)"));
  assert.ok(when.some((line) => line.startsWith("  When needed: the reading would not fit")));
  assert.ok(setting("ask", 200).includes("  Ask me first: golem shows the helpers it wants to start, with what each is asked, and waits for your Run."));
  assert.ok(setting("never", 200).includes("  Never: golem does all the work itself in the chat, however large it is."));
  assert.ok(setting(undefined).includes("use helpers: When needed (u changes)"));
  const narrow = setting("ask", 40).filter((line) => line.startsWith("  "));
  assert.ok(narrow.length > 1 && narrow.every((line) => line.length <= 40));
});

test("u cycles the three positions and asks to save the next; unknown says so", () => {
  assert.deepEqual([nextUseHelpers("when_needed"), nextUseHelpers("ask"), nextUseHelpers("never"), nextUseHelpers("odd")], ["ask", "never", "when_needed", "ask"]);
  const done = pressAgentsManager(openAgentsManager(), [], "helpers", { setup: "mixed", models: [], useHelpers: "ask" });
  assert.deepEqual(done.action, { kind: "use_helpers", value: "never" });
  const unknown = pressAgentsManager(openAgentsManager(), [], "helpers");
  assert.deepEqual(unknown.action, { kind: "none" });
  assert.equal(unknown.state.view.notice, USE_HELPERS_UNKNOWN);
});

test("a refused save shows one plain line", () => {
  assert.equal(useHelpersFailed(openAgentsManager(), new Error("config is read-only")).view.notice, "config is read-only");
  assert.equal(useHelpersFailed(openAgentsManager(), "x").view.notice, "Could not change Use helpers.");
});

function question(args: Record<string, unknown>): PendingApproval {
  return { callId: "c1", name: "delegate", args, source: "use_helpers", diff: null };
}

const BATCH = question({
  batch: [
    { agent: "explorer", label: "api", brief: "Read the routes\nand list them" },
    { agent: "explorer", brief: "Read the tests" },
    { agent: "worker", label: "fix", brief: "x".repeat(200) },
  ],
});

test("the question shows the head, a line per job and the two answers", () => {
  const lines = approvalLines(BATCH, 80, approvalRows(BATCH, 40)).map((line) => line.text);
  assert.equal(lines.length, approvalRows(BATCH, 40));
  assert.equal(lines[0], "Start 3 helpers · explorer ×2, worker?");
  assert.equal(lines[1], "  explorer · api — Read the routes and list them");
  assert.equal(lines[2], "  explorer — Read the tests");
  assert.equal(lines[3]?.length, 80);
  assert.ok(lines[3]?.endsWith("…"));
  assert.equal(lines[4], 'Use helpers is set to "Ask me first".');
  assert.equal(lines[5], "Enter run · d do it in the chat · Esc the same");
  assert.equal(lines.some((line) => line.includes("session")), false);
});

test("one helper, and too many jobs for the room", () => {
  const one = question({ agent: "explorer", brief: "Look" });
  assert.equal(approvalLines(one, 80, approvalRows(one, 40))[0]?.text, "Start 1 helper · explorer?");
  const short = approvalLines(BATCH, 80, APPROVAL_ROWS + 2).map((line) => line.text);
  assert.deepEqual(short.slice(1, 3), ["  explorer · api — Read the routes and list them", "  … and 2 more"]);
  assert.equal(short.length, APPROVAL_ROWS + 2);
});

function place(where: Partial<KeyPlace> = {}): KeyPlace {
  return {
    overlay: false, help: false, switcher: false, switcherConfirm: false, switcherFiltering: false, debug: false,
    draftEmpty: true, busy: true, connected: true, suggestions: false, history: false, ...where,
  };
}

test("Enter runs, d and Esc decline; the approval keys do nothing here", () => {
  const press = (where: KeyPlace, input: string, name: Parameters<typeof pressKey>[1]["name"] = null) => pressKey(where, { name, input, ctrl: false, meta: false });
  const at = place({ approval: true, useHelpers: true });
  assert.deepEqual(press(at, "", "return"), { kind: "helpers-run", run: true });
  assert.deepEqual(press(at, "d"), { kind: "helpers-run", run: false });
  assert.deepEqual(press(at, "", "escape"), { kind: "helpers-run", run: false });
  for (const key of ["a", "s", "w", "e"]) {
    assert.notEqual(press(at, key)?.kind, "approve");
    assert.notEqual(press(at, key)?.kind, "edit-args");
  }
  assert.deepEqual(press(place({ approval: true }), "", "return"), { kind: "approve", decision: "allow" });
  assert.deepEqual(press(place({ approval: true }), "s"), { kind: "approve", decision: "allow_session" });
  assert.notEqual(press(place({ useHelpers: true }), "", "return")?.kind, "helpers-run");
  assert.notEqual(press(place({ approval: true, useHelpers: true, overlay: true }), "d")?.kind, "helpers-run");
});

test("a batch item in the inbox reads as the card head and has no empty row", () => {
  const summary = {
    session_id: "lead",
    title: "Lead",
    status: "waiting" as const,
    pending: null,
    pending_items: [
      { kind: "batch" as const, since: "2026-11-16T09:50:00Z", call_id: "c1", helper_count: 3, agents: ["explorer", "explorer", "worker"], count: 1 },
      {
        kind: "approval" as const,
        since: "2026-11-16T09:51:00Z",
        call_id: "c2",
        name: "shell",
        subject: "uv lock",
        source: "built-in default",
        helper: { session_id: "h1", agent: "worker", label: "up", index: 1 },
        count: 1,
      },
    ],
  };
  const dock = helperDock(summary, null, Date.parse("2026-11-16T10:00:00Z"));
  assert.ok(dock);
  assert.equal(dock.item.kind, "batch");
  assert.deepEqual(
    helperAskLines(dock, 80).map((line) => line.text),
    ["Start 3 helpers · explorer ×2, worker? · 1 of 2 · tab next", 'Use helpers is set to "Ask me first".', "Enter run · d do it in the chat · Esc the same"],
  );
});
