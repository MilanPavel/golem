import assert from "node:assert/strict";
import { test } from "node:test";

import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import { Attachments } from "./attachments.ts";

function event(sessionId: string, seq: number): ChatEvent {
  return {
    seq,
    session_id: sessionId,
    run_id: "r",
    ts: "2026-10-14T10:00:00+00:00",
    type: "run.started",
    data: {},
  };
}

test("a followed session drops events it has seen", () => {
  const attachments = new Attachments();
  attachments.track("s_a", 0);
  assert.equal(attachments.accept(event("s_a", 1)), true);
  assert.equal(attachments.accept(event("s_a", 3)), true);
  assert.equal(attachments.accept(event("s_a", 3)), false);
  assert.equal(attachments.accept(event("s_a", 2)), false);
  assert.deepEqual(attachments.entries(), [["s_a", 3]]);
});

test("events of a session nobody follows pass through", () => {
  const attachments = new Attachments();
  assert.equal(attachments.accept(event("s_b", 1)), true);
  assert.equal(attachments.accept(event("s_b", 1)), true);
  assert.equal(attachments.seen("s_b"), undefined);
});

test("tracking again keeps the newer seq", () => {
  const attachments = new Attachments();
  attachments.track("s_a", 5);
  attachments.track("s_a", 2);
  assert.equal(attachments.seen("s_a"), 5);
  attachments.untrack("s_a");
  assert.equal(attachments.seen("s_a"), undefined);
});
