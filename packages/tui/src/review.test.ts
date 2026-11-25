import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewItemsOf, type InboxSession } from "@golem/view";

import { pressKey, type KeyPlace, type Press } from "./keys.ts";
import {
  liveReviewEdit,
  reviewAnswerParams,
  reviewEditLines,
  reviewLines,
  reviewPager,
  reviewRows,
  startReviewEdit,
} from "./review.ts";

const NOW = Date.parse("2026-11-25T08:52:00Z");

const session: InboxSession = {
  session_id: "s1",
  status: "waiting",
  pending_items: [
    {
      kind: "review",
      since: "2026-11-25T08:00:00Z",
      ask: "Open these pull requests?",
      preview: "httpx 0.27 → 0.28\npydantic 2.9 → 2.10",
      workflow_run_id: "wr1",
      key: "review:5",
    },
    { kind: "approval", since: "2026-11-25T07:00:00Z", call_id: "c1", name: "shell", subject: "ls" },
  ],
};

const item = reviewItemsOf(session, NOW)[0]!;

function press(input: string, name: Press["name"] = null): Press {
  return { input, name, ctrl: false, meta: false, shift: false };
}

const place: KeyPlace = {
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
  review: true,
};

test("a review item is listed with its run, key, ask and preview; other kinds are not", () => {
  const items = reviewItemsOf(session, NOW);
  assert.equal(items.length, 1);
  assert.deepEqual(
    [item.workflowRunId, item.key, item.ask, item.preview, item.age],
    ["wr1", "review:5", "Open these pull requests?", "httpx 0.27 → 0.28\npydantic 2.9 → 2.10", "52m"],
  );
});

test("a review without a run id or key, or in a closed session, is left out", () => {
  const bare: InboxSession = { ...session, pending_items: [{ kind: "review", since: "2026-11-25T08:00:00Z", ask: "x" }] };
  assert.deepEqual(reviewItemsOf(bare, NOW), []);
  assert.deepEqual(reviewItemsOf({ ...session, status: "closed" }, NOW), []);
});

test("the band shows the ask, the draft preview and the keys", () => {
  const lines = reviewLines(item, 80);
  assert.deepEqual(
    lines.map((line) => line.text),
    [
      "Review · Open these pull requests? · waiting 52m",
      "httpx 0.27 → 0.28",
      "pydantic 2.9 → 2.10",
      "y approve · r reply with edits · n reject",
    ],
  );
  assert.equal(lines[0]?.tone, "question");
  assert.equal(reviewRows(item, 80), 4);
  assert.equal(reviewLines(item, 80, reviewPager(0, 3))[0]?.text.endsWith("· 3 waiting"), true);
});

test("a long preview is cut to three lines", () => {
  const long = { ...item, preview: "x".repeat(200) };
  const lines = reviewLines(long, 30);
  assert.equal(lines.length, 5);
  assert.equal(lines[3]?.text.endsWith("…"), true);
});

test("y, r and n answer the review; keys do nothing without one or while typing", () => {
  assert.deepEqual(pressKey(place, press("y")), { kind: "review", verdict: "approve" });
  assert.deepEqual(pressKey(place, press("r")), { kind: "review-edit" });
  assert.deepEqual(pressKey(place, press("n")), { kind: "review", verdict: "reject" });
  assert.equal(pressKey({ ...place, review: false }, press("y")).kind, "insert");
  assert.equal(pressKey({ ...place, draftEmpty: false }, press("y")).kind, "insert");
});

test("in the editor, Enter sends, Esc goes back, and other keys edit the draft", () => {
  const editing = { ...place, reviewEdit: true };
  assert.deepEqual(pressKey(editing, press("", "return")), { kind: "review-args", key: { kind: "submit" } });
  assert.deepEqual(pressKey(editing, press("", "escape")), { kind: "review-args", key: { kind: "cancel" } });
  assert.deepEqual(pressKey(editing, press("y")), { kind: "review-args", key: { kind: "insert", text: "y" } });
});

test("the answers carry the item's run and key, and the text only for an edit", () => {
  assert.deepEqual(reviewAnswerParams(item, "approve"), { workflowRunId: "wr1", key: "review:5", verdict: "approve" });
  assert.deepEqual(reviewAnswerParams(item, "reject", "ignored"), { workflowRunId: "wr1", key: "review:5", verdict: "reject" });
  assert.deepEqual(reviewAnswerParams(item, "edit", "Open two"), {
    workflowRunId: "wr1",
    key: "review:5",
    verdict: "edit",
    text: "Open two",
  });
});

test("the editor starts with the preview, and drops when the review is gone", () => {
  const edit = startReviewEdit(item);
  assert.equal(edit.draft.text, item.preview);
  assert.equal(liveReviewEdit(edit, item), edit);
  assert.equal(liveReviewEdit(edit, { ...item, key: "review:6" }), null);
  assert.equal(liveReviewEdit(edit, null), null);
  const lines = reviewEditLines(item, { ...edit, loading: false, error: "boom" }, 80);
  assert.equal(lines.length, 3);
  assert.equal(lines[1]?.text, "boom");
});
