import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionSummary } from "./connect.ts";
import { mergeSummary } from "./session-index.ts";

function summary(id: string, updatedAt: string, lastSeq: number, title: string | null = null): SessionSummary {
  return {
    session_id: id,
    model_profile: "remote",
    title,
    status: "idle",
    created_at: "2026-10-07T10:00:00+00:00",
    updated_at: updatedAt,
    last_seq: lastSeq,
  };
}

test("a newer summary replaces the old one and moves the session up", () => {
  const index = [summary("s_a", "2026-10-07T10:02:00", 4), summary("s_b", "2026-10-07T10:01:00", 2)];
  const merged = mergeSummary(index, summary("s_b", "2026-10-07T10:03:00", 3, "Named"));
  assert.deepEqual(
    merged.map((item) => [item.session_id, item.last_seq, item.title]),
    [
      ["s_b", 3, "Named"],
      ["s_a", 4, null],
    ],
  );
});

test("an older summary of a known session is ignored", () => {
  const index = [summary("s_a", "2026-10-07T10:02:00", 4, "Named")];
  assert.equal(mergeSummary(index, summary("s_a", "2026-10-07T10:01:00", 3)), index);
});

test("a new session is added in activity order, ties broken by id", () => {
  const index = [summary("s_a", "2026-10-07T10:02:00", 1)];
  const merged = mergeSummary(index, summary("s_b", "2026-10-07T10:02:00", 1));
  assert.deepEqual(
    merged.map((item) => item.session_id),
    ["s_b", "s_a"],
  );
});
