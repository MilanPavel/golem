import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionSummary } from "@golem/client";

import {
  closedSwitcher,
  layoutSwitcher,
  openSwitcher,
  pressSwitcher,
  relativeAge,
  UNTITLED,
  type SwitcherKey,
  type SwitcherState,
} from "./switcher.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");

function summary(id: string, title: string | null = null, running = false): SessionSummary {
  return {
    session_id: id,
    model_profile: "remote",
    title,
    status: running ? "running" : "idle",
    created_at: "2026-10-15T11:00:00Z",
    updated_at: "2026-10-15T11:55:00Z",
    last_seq: 1,
  };
}

const SESSIONS = [summary("s_a", "Alpha", true), summary("s_b", "Beta"), summary("s_c")];

function press(keys: SwitcherKey[], start: SwitcherState = openSwitcher("s_a")) {
  let state = start;
  let action: ReturnType<typeof pressSwitcher>["action"] = { kind: "none" };
  for (const key of keys) {
    ({ state, action } = pressSwitcher(state, SESSIONS, key, "s_a"));
  }
  return { state, action };
}

test("arrow keys move the selection and stop at the ends", () => {
  assert.equal(press(["down"]).state.selected, "s_b");
  assert.equal(press(["down", "down", "down"]).state.selected, "s_c");
  assert.equal(press(["up"]).state.selected, "s_a");
});

test("enter opens the selected session and closes", () => {
  assert.deepEqual(press(["down", "enter"]), {
    state: closedSwitcher,
    action: { kind: "open", sessionId: "s_b" },
  });
});

test("enter on the current session, or esc, only closes", () => {
  assert.deepEqual(press(["enter"]).action, { kind: "close" });
  assert.deepEqual(press(["down", "close"]).action, { kind: "close" });
  assert.deepEqual(press(["new"]).action, { kind: "new" });
});

test("a selection that left the list falls back to the first session", () => {
  assert.equal(press(["down"], openSwitcher("s_gone")).state.selected, "s_b");
  assert.equal(pressSwitcher(openSwitcher(null), [], "down", null).state.selected, null);
});

test("rows show the status, title, age, and which one is current", () => {
  const rows = layoutSwitcher({
    state: openSwitcher("s_b"),
    sessions: SESSIONS,
    current: "s_a",
    now: NOW,
    columns: 40,
    rows: 5,
  });
  assert.deepEqual(
    rows.map((row) => [row.sessionId, row.selected, row.current, row.running, row.title, row.age]),
    [
      ["s_a", false, true, true, "Alpha", "5m"],
      ["s_b", true, false, false, "Beta", "5m"],
      ["s_c", false, false, false, UNTITLED, "5m"],
    ],
  );
});

test("a long list scrolls to keep the selection visible, and long titles are cut", () => {
  const rows = layoutSwitcher({
    state: openSwitcher("s_c"),
    sessions: [summary("s_a", "x".repeat(50)), ...SESSIONS.slice(1)],
    current: null,
    now: NOW,
    columns: 20,
    rows: 2,
  });
  assert.deepEqual(
    rows.map((row) => row.sessionId),
    ["s_b", "s_c"],
  );
  const first = layoutSwitcher({
    state: openSwitcher("s_a"),
    sessions: [summary("s_a", "x".repeat(50))],
    current: null,
    now: NOW,
    columns: 20,
    rows: 2,
  })[0];
  assert.equal(first?.title, `${"x".repeat(11)}…`);
});

test("typing filters by title, and movement stays inside the matches", () => {
  const typed = press([{ kind: "type", text: "b" }]);
  assert.equal(typed.state.query, "b");
  assert.equal(typed.state.open, true);
  const rows = layoutSwitcher({
    state: typed.state,
    sessions: SESSIONS,
    current: "s_a",
    now: NOW,
    columns: 40,
    rows: 5,
  });
  assert.deepEqual(
    rows.map((row) => row.sessionId),
    ["s_b"],
  );
  assert.equal(press([{ kind: "type", text: "b" }, "down"]).state.selected, "s_b");
});

test("Ctrl-D then y closes the selected session and leaves the list open", () => {
  const asked = press(["down", "arm"]);
  assert.equal(asked.state.confirm, true);
  assert.equal(asked.state.open, true);
  assert.deepEqual(press(["down", "arm", "confirm"]), {
    state: { ...openSwitcher("s_b"), confirm: false },
    action: { kind: "close-session", sessionId: "s_b" },
  });
});

test("Esc during confirm only cancels it, and Esc with a filter clears the filter", () => {
  const armed = press(["arm", "disarm"]);
  assert.equal(armed.state.confirm, false);
  assert.equal(armed.state.open, true);
  assert.deepEqual(armed.action, { kind: "none" });
  const cleared = press([{ kind: "type", text: "be" }, "backspace", "clear-query"]);
  assert.equal(cleared.state.query, "");
  assert.equal(cleared.state.open, true);
});

test("n starts a session only through the new key, and an empty match list does not ask to close", () => {
  assert.deepEqual(press(["new"]).action, { kind: "new" });
  const missed = pressSwitcher(
    { ...openSwitcher("s_a"), query: "zzz" },
    SESSIONS,
    "arm",
    "s_a",
  );
  assert.equal(missed.state.confirm, false);
  assert.deepEqual(missed.action, { kind: "none" });
});

test("ages read as now, minutes, hours, days, then a date", () => {
  const cases: [string, string][] = [
    ["2026-10-15T11:59:30Z", "now"],
    ["2026-10-15T11:15:00Z", "45m"],
    ["2026-10-15T07:00:00Z", "5h"],
    ["2026-10-12T12:00:00Z", "3d"],
    ["2026-09-01T12:00:00Z", "2026-09-01"],
    ["not a date", ""],
  ];
  for (const [iso, expected] of cases) {
    assert.equal(relativeAge(iso, NOW), expected, iso);
  }
});
