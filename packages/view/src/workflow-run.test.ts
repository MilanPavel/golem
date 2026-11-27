import assert from "node:assert/strict";
import { test } from "node:test";

import { resultKind, reviewDraftText, reviewTitle, stepLabel, stepMetaLine, stepOutputLine, toolAsk, workerLine, workerResult, workflowRunTook, workflowStepsList } from "./workflow-run.ts";

const T = (s: number) => new Date(Date.UTC(2026, 10, 26, 8, 0, s)).toISOString();
const step = (key: string, extra: Record<string, unknown> = {}) => ({ key, kind: "step", title: key, status: "done", started_at: T(0), finished_at: T(10), ...extra });

test("steps become rows with their taken time, running ones run to now and a review waits for you", () => {
  const list = workflowStepsList(
    [step("a"), step("b", { status: "running", started_at: T(10), finished_at: null }), step("c", { kind: "review", status: "waiting", started_at: T(10), finished_at: null })],
    Date.UTC(2026, 10, 26, 8, 0, 30),
  );
  assert.deepEqual(list.rows.map((row) => [row.id, row.right, row.tone, row.took]), [
    ["a", "done", "ok", "0m 10s"],
    ["b", "running", "run", "0m 20s"],
    ["c", "waiting for you", "wait", "0m 20s"],
  ]);
  assert.equal(list.rows[2]?.segments[0]?.kind, "you");
});

test("a step reads as its title, then its item", () => {
  assert.equal(stepLabel({ title: "Check folder", item: "golem" }), "Check folder \u00b7 golem");
  assert.equal(stepLabel({ title: "Check folder", item: null }), "Check folder");
  assert.equal(stepLabel({ title: "Check folder" }), "Check folder");
  const list = workflowStepsList([step("a", { title: "Check folder", item: "golem" })], Date.UTC(2026, 10, 26, 8, 0, 30));
  assert.equal(list.rows[0]?.label, "Check folder \u00b7 golem");
});

test("a step that has not started begins now", () => {
  const list = workflowStepsList([step("a", { status: "pending", started_at: null, finished_at: null })], 5000);
  assert.equal(list.rows[0]?.right, "not started");
});

test("a worker's result is a diff line", () => {
  const result = { worktree: "w1", diff: "a_1", files: [{}, {}], added: 12, removed: 4, checks: "passed", checks_note: null };
  assert.equal(workerResult(result)?.diff, "a_1");
  assert.equal(workerLine(workerResult(result)!), "2 files · +12 −4 · checks passed");
  assert.equal(stepOutputLine({ kind: "agent", result }), "2 files · +12 −4 · checks passed");
  assert.equal(workerResult({ files: [] }), null);
});

test("the one line of an output", () => {
  assert.equal(stepOutputLine({ kind: "step", result: "line one\n\nline   two" }), "line one line two");
  assert.equal(stepOutputLine({ kind: "tool", result: { summary: "big", artifact_id: "a", size: 9 } }), "big");
  assert.equal(stepOutputLine({ kind: "review", result: { verdict: "reject", text: "too long" } }), "rejected · too long");
  assert.equal(stepOutputLine({ kind: "review", result: { verdict: "approve", text: "x" } }), "approved");
  assert.equal(stepOutputLine({ kind: "step", result: [1, 2] }), "[1,2]");
  assert.equal(stepOutputLine({ kind: "step", result: null }), "");
});

test("a result has a kind by its shape", () => {
  const worker = { worktree: "wf-1", files: [], added: 0, removed: 0 };
  assert.deepEqual(
    ["hello", "/Users/you/a.md", "~/notes/a.md", "https://example.com/x", "see /tmp/a", { a: 1 }, [{ a: 1 }], worker, null, "", [], {}, [1, 2], 7].map(resultKind),
    ["text", "file", "file", "link", "text", "record", "table", "changes", "empty", "empty", "empty", "empty", "other", "other"],
  );
});

test("the one line says each kind in words", () => {
  assert.equal(stepOutputLine({ kind: "step", result: [] }), "Nothing found");
  assert.equal(stepOutputLine({ kind: "step", result: {} }), "Nothing found");
  assert.equal(stepOutputLine({ kind: "step", result: new Array(8).fill({ a: 1 }) }), "8 rows");
  assert.equal(stepOutputLine({ kind: "step", result: [{ a: 1 }] }), "1 row");
  assert.equal(stepOutputLine({ kind: "step", result: { branch: "main", commits: ["a"], files: 3, dirty: false, extra: 1 } }), "branch main · files 3 · dirty false");
  assert.equal(stepOutputLine({ kind: "step", result: { list: [1], inner: { a: 1 } } }), "2 fields");
  assert.equal(stepOutputLine({ kind: "step", result: "~/.golem/briefings/2026-11-27.md" }), "~/.golem/briefings/2026-11-27.md");
  assert.equal(stepOutputLine({ kind: "step", result: "https://example.com/a" }), "https://example.com/a");
});

test("model and cost", () => {
  assert.equal(stepMetaLine({ kind: "llm", model: "deepseek/chat", cost_usd: 0.0234 }), "llm · deepseek/chat · $0.02");
  assert.equal(stepMetaLine({ kind: "step" }), "step");
  assert.equal(stepMetaLine({ kind: "llm", model: null, cost_usd: 0 }), "llm · $0");
});

test("a tool ask is a review with the tool in its title", () => {
  const draft = { tool: "gh_pr_create", args: { title: "x" }, source: "ask rule" };
  assert.deepEqual(toolAsk(draft), { tool: "gh_pr_create", args: { title: "x" }, source: "ask rule" });
  assert.equal(toolAsk("text"), null);
  assert.equal(reviewTitle({ ask: "Run gh_pr_create?", draft }), "Run gh_pr_create?");
  assert.equal(reviewTitle({ ask: "Send this?", draft: "Dear Ann" }), "Send this?");
  assert.equal(reviewDraftText("Dear Ann"), "Dear Ann");
  assert.equal(reviewDraftText({ a: 1 }), '{\n  "a": 1\n}');
});

test("how long a run took", () => {
  assert.equal(workflowRunTook({ started_at: T(0), finished_at: T(70) }, 0), "1m 10s");
  assert.equal(workflowRunTook({ started_at: null }, 0), "");
});
