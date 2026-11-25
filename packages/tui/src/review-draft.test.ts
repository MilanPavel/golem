import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewItemsOf, type InboxSession } from "@golem/view";

import { DRAFT_CUT_WARNING, openReviewEdit, reviewEditLines, startReviewEdit, submitReviewAnswer } from "./review.ts";

const session: InboxSession = {
  session_id: "s1",
  status: "waiting",
  pending_items: [
    { kind: "review", since: "2026-11-25T08:00:00Z", ask: "Open these pull requests?", preview: "cut", workflow_run_id: "wr1", key: "review:5" },
  ],
};
const item = reviewItemsOf(session, Date.parse("2026-11-25T08:52:00Z"))[0]!;

test("r loads the full draft from workflow.status into the editor", async () => {
  const full = "z".repeat(450);
  const asked: string[] = [];
  const client = {
    workflowStatus: async (id: string) => {
      asked.push(id);
      return { reviews: [{ key: "other", draft: "no" }, { key: "review:5", draft: full }] };
    },
    answerWorkflowReview: async () => ({}),
  };
  const opened = await openReviewEdit(client, item);
  assert.deepEqual(asked, ["wr1"]);
  assert.equal(opened.draft.text, full);
  assert.equal(opened.loading, false);
  assert.equal(opened.warning, null);
  assert.equal(reviewEditLines(item, opened, 80)[1]?.text, "the run continues with your text");
});

test("a draft that is not a string is prefilled as pretty JSON", async () => {
  const client = {
    workflowStatus: async () => ({ reviews: [{ key: "review:5", draft: { a: 1 } }] }),
    answerWorkflowReview: async () => ({}),
  };
  assert.equal((await openReviewEdit(client, item)).draft.text, '{\n  "a": 1\n}');
});

test("the editor shows loading first, and falls back to the preview with a warning", async () => {
  const start = startReviewEdit(item);
  assert.equal(start.loading, true);
  assert.equal(reviewEditLines(item, start, 80)[1]?.text, "loading draft…");
  for (const status of [
    async () => {
      throw new Error("offline");
    },
    async () => ({ reviews: [] }),
  ]) {
    const opened = await openReviewEdit({ workflowStatus: status, answerWorkflowReview: async () => ({}) }, item);
    assert.equal(opened.draft.text, item.preview);
    assert.equal(opened.loading, false);
    assert.equal(opened.warning, DRAFT_CUT_WARNING);
    assert.equal(reviewEditLines(item, opened, 100)[1]?.text, DRAFT_CUT_WARNING);
  }
});

test("each answer is sent through answerWorkflowReview with the item's run and key", async () => {
  const calls: unknown[][] = [];
  const client = {
    workflowStatus: async () => ({}),
    answerWorkflowReview: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  };
  await submitReviewAnswer(client, item, "approve");
  await submitReviewAnswer(client, item, "edit", "Open two");
  await submitReviewAnswer(client, item, "reject");
  assert.deepEqual(calls, [
    ["wr1", "review:5", "approve", undefined],
    ["wr1", "review:5", "edit", "Open two"],
    ["wr1", "review:5", "reject", undefined],
  ]);
});
