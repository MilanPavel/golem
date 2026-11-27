import assert from "node:assert/strict";
import { test } from "node:test";

import type { Press } from "./keys.ts";
import {
  applyStepNotice,
  closedWorkflowRun,
  layoutWorkflowRun,
  openWorkflowRun,
  resultPagerText,
  runOutputs,
  pressWorkflowRun,
  runIsLive,
  stepMark,
  workflowRunKeyOf,
  type WorkflowRunData,
  type WorkflowRunKey,
  type WorkflowRunManagerState,
  type WorkflowStepInfo,
} from "./workflow-run-manager.ts";

const NOW = new Date(2026, 10, 18, 9, 15, 0).getTime();
const at = (minute: number, second = 0): string => new Date(2026, 10, 18, 9, minute, second).toISOString();

const fetchStep: WorkflowStepInfo = { key: "fetch_prs", kind: "step", title: "fetch_prs", status: "done", started_at: at(0), finished_at: at(0, 1), result: "12 PRs" } as unknown as WorkflowStepInfo;
const askStep: WorkflowStepInfo = { key: "ask", kind: "agent", title: "summarize", status: "done", started_at: at(0, 2), finished_at: at(0, 43), child_session_id: "child-1", model: "qwen3-coder:30b", cost_usd: 0 } as unknown as WorkflowStepInfo;
const workerStep: WorkflowStepInfo = {
  key: "fix",
  kind: "agent",
  title: "fix_tests",
  status: "done",
  started_at: at(1),
  finished_at: at(5),
  child_session_id: "child-2",
  result: { worktree: "/tmp/copy", files: ["a.py", "b.py"], added: 12, removed: 4, checks: "passed", diff: "…" },
} as unknown as WorkflowStepInfo;
const reviewStep: WorkflowStepInfo = { key: "review", kind: "review", title: "review", status: "waiting", started_at: at(1) } as unknown as WorkflowStepInfo;
const postStep: WorkflowStepInfo = { key: "post", kind: "step", title: "post_digest", status: "pending" } as unknown as WorkflowStepInfo;

function data(extra: Partial<Omit<NonNullable<WorkflowRunData["status"]>["run"], "outputs">> & { outputs?: unknown[] } = {}, steps = [fetchStep, askStep, reviewStep, postStep], reviews: unknown[] = []): WorkflowRunData {
  return {
    error: null,
    status: {
      run: { workflow_run_id: "wr_7f3a", workflow_id: "w", name: "pr-digest", status: "waiting", trigger: "schedule", started_at: at(0), finished_at: null, session_id: "sess-run", error: null, ...extra },
      steps,
      reviews: reviews as never,
    } as never,
  };
}
const REVIEW = { key: "review", ask: "Review the digest", draft: "line one\nline two\nline three\nline four", created_at: at(1), answered: false };

function press(state: WorkflowRunManagerState, d: WorkflowRunData, ...keys: WorkflowRunKey[]) {
  let current = state;
  let action: ReturnType<typeof pressWorkflowRun>["action"] = { kind: "none" };
  for (const key of keys) {
    const pressed = pressWorkflowRun(current, d, key);
    current = pressed.state;
    action = pressed.action;
  }
  return { state: current, action };
}

const screen = (state: WorkflowRunManagerState, d: WorkflowRunData, rows = 30) =>
  layoutWorkflowRun({ state, data: d, now: NOW, columns: 100, rows }).map((line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`);

const open = openWorkflowRun("wr_7f3a", "runs");

test("the header names the run by its title and state, then who started it, when and how long", () => {
  const lines = screen(open, data({ status: "waiting" }));
  assert.equal(lines[0], "! pr-digest  waiting for you");
  assert.equal(lines[1], "by schedule · started 09:00 · 15m 00s · qwen3-coder:30b");
  const titled = screen(open, data({ status: "done", title: "Morning briefing", description: "What happened in your projects", summary: "2 projects need you" }));
  assert.equal(titled[0], "✔ Morning briefing  done");
  assert.ok(titled.includes("Goal: What happened in your projects"));
  assert.ok(titled.includes("2 projects need you"));
});

test("each step has its mark, time and result; the waiting and the pending ones say so", () => {
  const lines = screen(open, data());
  assert.ok(lines.some((line) => line.startsWith("❯ ✔ fetch_prs") && line.includes("1s") && line.endsWith("12 PRs")));
  assert.ok(lines.some((line) => line.startsWith("  ✔ summarize")));
  assert.ok(lines.some((line) => line.startsWith("  ! review") && line.endsWith("waiting for you")));
  assert.ok(lines.some((line) => line.startsWith("  ○ post_digest") && line.endsWith("not started")));
});

test("a failed step shows its error, and a failed run shows why it failed", () => {
  const bad = { ...fetchStep, status: "failed", error: "Traceback\nValueError: no PRs" } as unknown as WorkflowStepInfo;
  const lines = screen(open, data({ status: "failed", error: "step fetch_prs failed" }, [bad]));
  assert.ok(lines.some((line) => line === "✘ step fetch_prs failed"));
  assert.ok(lines.some((line) => line.startsWith("❯ ✘ fetch_prs") && line.includes("Traceback")));
  assert.ok(lines.some((line) => line.startsWith("      ") === false && line.includes("✘ ValueError: no PRs")));
});

test("the selected step unfolds: an agent step shows its child session, model and output", () => {
  const lines = screen({ ...open, selected: 1 }, data());
  assert.ok(lines.some((line) => line.trim() === "agent · qwen3-coder:30b · $0"));
  assert.ok(lines.some((line) => line.includes("helper session child-1 · Enter opens its chat")));
  assert.ok(!lines.some((line) => line.includes("12 PRs") && line.startsWith("    ")));
});

test("a worker step shows the copy, the changed files and the checks", () => {
  const lines = screen({ ...open, selected: 0 }, data({}, [workerStep]));
  assert.ok(lines.some((line) => line.includes("copy      /tmp/copy")));
  assert.ok(lines.some((line) => line.includes("changed   2 files · +12 −4")));
  assert.ok(lines.some((line) => line.includes("checks    passed")));
  assert.ok(lines.some((line) => line.startsWith("❯ ✔ fix_tests") && line.endsWith("2 files · +12 −4 · checks passed")));
});

test("a long output is cut to eight lines with the rest counted", () => {
  const long = { ...fetchStep, result: Array.from({ length: 12 }, (_, index) => `row ${index}`).join("\n") } as unknown as WorkflowStepInfo;
  const lines = screen(open, data({}, [long]));
  assert.ok(lines.includes("    row 7"));
  assert.ok(!lines.includes("    row 8"));
  assert.ok(lines.includes("    … 4 more lines"));
});

test("a review shows its title, the start of the draft and the keys", () => {
  const lines = screen(open, data({}, undefined, [REVIEW]));
  assert.ok(lines.includes("! Review · Review the digest"));
  assert.ok(lines.includes("  line one"));
  assert.ok(lines.includes("  … 1 more lines"));
  assert.ok(lines.at(-1)?.includes("y approve · r reply with edits · n reject"));
  assert.ok(lines.at(-1)?.includes("c cancel the run"));
});

test("the hint offers resume only for a failed run, cancel only for a live one", () => {
  assert.ok(screen(open, data({ status: "failed" })).at(-1)?.includes("s resume"));
  assert.ok(!screen(open, data({ status: "failed" })).at(-1)?.includes("cancel"));
  assert.ok(!screen(open, data({ status: "done" })).at(-1)?.includes("s resume"));
  assert.equal(runIsLive({ status: "pending" }), true);
  assert.equal(runIsLive({ status: "cancelled" }), false);
});

test("the screen says it is loading, or why it could not load", () => {
  assert.ok(screen(open, { status: null, error: null }).includes("asking the daemon…"));
  assert.ok(screen(open, { status: null, error: "no such run" }).includes("no such run"));
});

test("up and down choose a step within the list", () => {
  const d = data();
  assert.equal(press(open, d, "down", "down").state.selected, 2);
  assert.equal(press(open, d, "up").state.selected, 0);
  assert.equal(press(open, d, "down", "down", "down", "down", "down").state.selected, 3);
});

test("Enter opens the helper session of an agent step, and says so for another", () => {
  const d = data();
  assert.deepEqual(press({ ...open, selected: 1 }, d, "enter").action, { kind: "open-chat", sessionId: "child-1" });
  const none = press(open, d, "enter");
  assert.deepEqual(none.action, { kind: "none" });
  assert.equal(none.state.notice, "This step has no helper session to open.");
  assert.ok(screen(none.state, d).some((line) => line.includes("no helper session")));
  assert.equal(press(none.state, d, "up").state.notice, null);
});

test("y and n answer the oldest review, r opens the run's session for the edit", () => {
  const d = data({}, undefined, [REVIEW, { ...REVIEW, key: "other" }]);
  assert.deepEqual(press(open, d, "approve").action, { kind: "answer", key: "review", verdict: "approve" });
  assert.deepEqual(press(open, d, "reject").action, { kind: "answer", key: "review", verdict: "reject" });
  assert.deepEqual(press(open, d, "reply").action, { kind: "open-review", sessionId: "sess-run" });
  const noSession = data({ session_id: null }, undefined, [REVIEW]);
  assert.equal(press(open, noSession, "reply").state.notice, "This run has no session to edit the draft in.");
});

test("with no review waiting y and n say so, and r shows the result instead", () => {
  for (const key of ["approve", "reject"] as const) {
    const pressed = press(open, data(), key);
    assert.deepEqual(pressed.action, { kind: "none" });
    assert.equal(pressed.state.notice, "No review waits on this run.");
  }
  const nothing = press(open, data({ status: "running" }), "reply");
  assert.deepEqual(nothing.action, { kind: "none" });
  assert.equal(nothing.state.notice, "No result yet. It shows here when the run has one.");
  assert.equal(press(open, data({ status: "failed" }), "reply").state.notice, "Nothing found");
});

test("c cancels a live run and says so for one that ended", () => {
  assert.deepEqual(press(open, data({ status: "running" }), "cancel").action, { kind: "cancel" });
  assert.deepEqual(press(open, data({ status: "waiting" }), "cancel").action, { kind: "cancel" });
  const ended = press(open, data({ status: "done" }), "cancel");
  assert.deepEqual(ended.action, { kind: "none" });
  assert.equal(ended.state.notice, "The run has ended already.");
});

test("s resumes a failed run and says so for another", () => {
  assert.deepEqual(press(open, data({ status: "failed" }), "resume").action, { kind: "resume" });
  const waiting = press(open, data({ status: "waiting" }), "resume");
  assert.deepEqual(waiting.action, { kind: "none" });
  assert.equal(waiting.state.notice, "Only a run that failed resumes.");
});

test("Esc closes and says where it came from; keys before the run arrives do nothing", () => {
  const closed = press(open, data(), "back");
  assert.deepEqual(closed.state, closedWorkflowRun);
  assert.deepEqual(closed.action, { kind: "close", from: "runs" });
  assert.deepEqual(press(open, { status: null, error: null }, "approve").action, { kind: "none" });
  assert.deepEqual(press(openWorkflowRun("x", "workflows"), { status: null, error: null }, "back").action, { kind: "close", from: "workflows" });
});

test("a step notification changes the step in place, and a new step is added; another run's is ignored", () => {
  const d = data({ status: "running" }, [fetchStep, { ...reviewStep, status: "running" } as unknown as WorkflowStepInfo]);
  const done = applyStepNotice(d, { ...reviewStep, status: "done", result: { verdict: "approve" }, workflow_run_id: "wr_7f3a" } as never);
  assert.equal(done.status?.steps?.[1]?.status, "done");
  assert.equal(done.status?.steps?.length, 2);
  const added = applyStepNotice(d, { ...postStep, status: "running", workflow_run_id: "wr_7f3a" } as never);
  assert.deepEqual(added.status?.steps?.map((step) => step.key), ["fetch_prs", "review", "post"]);
  assert.equal(applyStepNotice(d, { ...postStep, workflow_run_id: "other" } as never), d);
  assert.deepEqual(screen(open, done).some((line) => line.includes("approved")), true);
});

test("the marks", () => {
  assert.deepEqual(["pending", "running", "waiting", "done", "failed", "skipped", "in_doubt"].map((status) => stepMark(status).text), ["○", "●", "!", "✔", "✘", "○", "!"]);
});

test("the keys", () => {
  const key = (name: Press["name"], input = ""): Press => ({ name, input, ctrl: false, meta: false });
  assert.equal(workflowRunKeyOf(key("return")), "enter");
  assert.deepEqual(["y", "r", "n", "c", "s", "x"].map((input) => workflowRunKeyOf(key(null, input))), ["approve", "reply", "reject", "cancel", "resume", null]);
});

test("a short terminal keeps the selected step and the hint on screen", () => {
  const steps = Array.from({ length: 20 }, (_, index) => ({ ...fetchStep, key: `s${index}`, title: `step_${index}` }) as unknown as WorkflowStepInfo);
  const lines = screen({ ...open, selected: 15 }, data({}, steps), 8);
  assert.equal(lines.length, 8);
  assert.ok(lines.some((line) => line.startsWith("❯ ✔ step_15")));
  assert.ok(lines.at(-1)?.includes("Esc back"));
});

const item = (n: number, status: string, extra: Record<string, unknown> = {}) =>
  ({ key: `feed_${n}`, kind: "step", title: "Read each feed", item: `feed ${n}`, status, of: 30, started_at: at(2, n), finished_at: status === "done" ? at(2, n + 1) : null, result: status === "done" ? `${n} items` : null, ...extra }) as unknown as WorkflowStepInfo;

test("a run with 30 repeated steps is one row with its count and fits one screen", () => {
  const items = Array.from({ length: 30 }, (_, n) => item(n, n < 12 ? "done" : n === 12 ? "running" : "pending"));
  const d = data({ status: "running", steps_expected: 4 }, [fetchStep, ...items, postStep]);
  const lines = screen(open, d, 24);
  assert.ok(lines.length <= 24);
  assert.equal(lines.filter((line) => line.includes("Read each feed")).length, 2, "the row and the working line");
  assert.ok(lines.some((line) => line.startsWith("  ● Read each feed") && line.endsWith("12 of 30")));
  assert.ok(lines.some((line) => line.includes("Read each feed 13 of 30 · feed 12")));
  assert.ok(lines.some((line) => line.startsWith("  ○ post_digest")));
  assert.ok(!lines.some((line) => line.includes("feed 5") && line.includes("5 items")));
});

test("a repeating row counts the ones that failed, and Enter opens and folds its items", () => {
  const items = [item(0, "done"), item(1, "failed", { error: "timeout", result: null }), item(2, "done")];
  const d = data({ status: "running" }, [fetchStep, ...items]);
  const row = screen({ ...open, selected: 1 }, d).find((line) => line.startsWith("❯ ✘ Read each feed"));
  assert.ok(row?.endsWith("2 of 30 · 1 failed"), row);
  const opened = press({ ...open, selected: 1 }, d, "enter");
  assert.deepEqual(opened.action, { kind: "none" });
  assert.deepEqual(opened.state.unfolded, ["Read each feed"]);
  const lines = screen(opened.state, d);
  assert.ok(lines.some((line) => line.startsWith("    ✘ feed 1") && line.endsWith("timeout")));
  assert.ok(lines.some((line) => line.startsWith("    ✔ feed 0") && line.endsWith("0 items")));
  assert.deepEqual(press(opened.state, d, "enter").state.unfolded, []);
});

test("one progress line: a bar and the count when the total is known, only the count so far when it is not", () => {
  const going = [fetchStep, { ...askStep, status: "running" } as unknown as WorkflowStepInfo];
  const known = screen(open, data({ status: "running", steps_expected: 4 }, going));
  const bar = known.find((line) => line.endsWith("1 of 4 steps"));
  assert.ok(bar?.startsWith("━━━━━━"), bar);
  assert.equal(known.filter((line) => /steps/.test(line) && /[━─]/.test(line)).length, 1);
  const unknown = screen(open, data({ status: "running" }, going));
  assert.ok(unknown.includes("2 steps so far"));
  assert.ok(!unknown.some((line) => /[━─]{4}/.test(line)));
  assert.ok(screen(open, data({ status: "done" }, [fetchStep, askStep])).includes("━━━━━━━━━━━━━━━━━━━━━━━━  2 of 2 steps"));
});

test("what works now is a line with its time, and the usual time shows while it runs", () => {
  const writing = { ...askStep, key: "write", title: "Write the briefing", status: "running", finished_at: null, started_at: at(14, 30) } as unknown as WorkflowStepInfo;
  const lines = screen(open, data({ status: "running", usual_ms: 45000 }, [fetchStep, writing]));
  assert.ok(lines.includes("● Write the briefing  30s"));
  assert.ok(lines[1]?.includes("usually about 45s"));
  assert.ok(!screen(open, data({ status: "done", usual_ms: 45000 }, [fetchStep])).some((line) => line.includes("usually")));
});

test("the text of a model step shows as it comes, and only while it runs", () => {
  const writing = { ...askStep, key: "write", title: "Write the briefing", status: "running", finished_at: null, progress: "Good morning.\n\nTwo projects need you:\n- golem has 3 files not committed" } as unknown as WorkflowStepInfo;
  const lines = screen(open, data({ status: "running" }, [fetchStep, writing]));
  const from = lines.indexOf("Write the briefing:");
  assert.ok(from > 0);
  assert.deepEqual(lines.slice(from + 1, from + 3), ["  Two projects need you:", "  - golem has 3 files not committed"]);
  assert.ok(!screen(open, data({ status: "done" }, [{ ...writing, status: "done" } as WorkflowStepInfo])).includes("Write the briefing:"));
});

test("a done run says what came out by its kind: text, a file, a table, or nothing", () => {
  const done = (extra: Record<string, unknown>, steps = [fetchStep]) => screen(open, data({ status: "done", ...extra }, steps));
  assert.ok(done({ outputs: [{ title: "Briefing", value: "Two projects need you" }] }).includes("✔ Result: Two projects need you"));
  assert.ok(done({ outputs: [{ value: "~/briefings/2026-11-27.md" }] }).includes("✔ Result: file ~/briefings/2026-11-27.md"));
  assert.ok(done({ outputs: [{ value: [{ a: 1 }, { a: 2 }] }] }).includes("✔ Result: 2 rows"));
  assert.ok(done({ outputs: [{ summary: "5 new items", value: ["x"] }] }).some((line) => line === "✔ Result: 5 new items"));
  assert.ok(done({ result: { summary: "42 PRs" } }).includes("✔ Result: 42 PRs"));
  assert.ok(done({}).includes("Result: Nothing found"));
  const sent = { key: "n", kind: "notify", title: "Send it to the Inbox", status: "done", result: "sent to the Inbox" } as unknown as WorkflowStepInfo;
  assert.ok(done({}, [fetchStep, sent]).includes("✔ Send it to the Inbox: sent to the Inbox"));
  assert.ok(!screen(open, data({ status: "failed", error: "x" })).some((line) => line.startsWith("Result")));
});

test("r shows the result: the marked ones, else the return value, else what the run did", () => {
  const withText = data({ status: "done", outputs: [{ title: "Briefing", value: "Good morning" }, { title: "Data", value: [{ a: 1 }] }] });
  const shown = press(open, withText, "reply").action;
  assert.equal(shown.kind, "show-result");
  assert.deepEqual(shown.kind === "show-result" ? shown.outputs.map((output) => [output.index, output.title]) : null, [[0, "Briefing"], [1, "Data"]]);
  assert.deepEqual(runOutputs({ outputs: [], result: "x" } as never), [{ index: null, title: "Result", summary: null, value: "x" }]);
  const sent = { key: "n", kind: "notify", title: "Send it to the Inbox", status: "done", result: "sent" } as unknown as WorkflowStepInfo;
  const did = press(open, data({ status: "done" }, [fetchStep, sent]), "reply").action;
  assert.deepEqual(did.kind === "show-result" ? did.outputs[0]?.value : null, "- Send it to the Inbox: sent");
  assert.ok(screen(open, withText).at(-1)?.includes("r result"));
  assert.ok(!screen(open, data({ status: "done" })).at(-1)?.includes("r result"));
});

test("the result in the pager: text rendered as Markdown, a table as a table, a file as it was read", () => {
  const out = (value: unknown, extra: Partial<{ index: number | null; title: string; summary: string | null }> = {}) => ({ index: 0, title: "Result", summary: null, value, ...extra });
  const text = resultPagerText([out("# Morning briefing\n\nTwo **projects** need you.")], new Map(), 60);
  assert.ok(text.includes("Morning briefing"));
  assert.ok(!text.includes("# "));
  assert.ok(!text.includes("**"));
  const table = resultPagerText([out([{ name: "golem", files: 3 }, { name: "docs", files: 12 }])], new Map(), 60).split("\n");
  assert.deepEqual(table.slice(0, 4), ["name   files", "─────  ─────", "golem  3", "docs   12"]);
  assert.equal(table.at(-1), "2 rows");
  const file = resultPagerText([out("/tmp/b.md")], new Map([[0, { path: "/tmp/b.md", text: "# Day\n\n- one", truncated: true }]]), 60);
  assert.ok(file.startsWith("File /tmp/b.md"));
  assert.ok(file.includes("Day") && !file.includes("# Day"));
  assert.ok(file.includes("cut here"));
  assert.ok(resultPagerText([out("/tmp/b.md")], new Map([[0, { error: "gone" }]]), 60).includes("gone"));
  const many = resultPagerText([out("a", { title: "One" }), out("b", { index: 1, title: "Two" })], new Map(), 60);
  assert.ok(many.startsWith("One\n───\n\na"));
  assert.ok(many.includes("\n\nTwo\n"));
});
