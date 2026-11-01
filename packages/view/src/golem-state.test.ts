import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConnectionState } from "@golem/client";

import { type GolemState, golemState, type RunPhase } from "./golem-state.ts";

const STATUSES: ConnectionState["status"][] = [
  "connecting",
  "connected",
  "reconnecting",
  "closed",
  "rejected",
  "unauthorized",
];
const PHASES: (RunPhase | null)[] = [null, "thinking", "writing", "waiting"];

function expected(connection: string, phase: RunPhase | null, error: boolean): GolemState {
  if (connection !== "connected") return "offline";
  if (phase === "waiting") return "waiting";
  if (phase !== null) return "thinking";
  return error ? "failed" : "idle";
}

test("every combination follows the precedence", () => {
  for (const connection of STATUSES) {
    for (const phase of PHASES) {
      for (const error of [false, true]) {
        assert.equal(golemState({ connection, phase, error }), expected(connection, phase, error));
      }
    }
  }
});

test("the named cases", () => {
  assert.equal(golemState({ connection: "closed", phase: "waiting", error: true }), "offline");
  assert.equal(golemState({ connection: "connected", phase: "waiting", error: true }), "waiting");
  assert.equal(golemState({ connection: "connected", phase: "writing", error: true }), "thinking");
  assert.equal(golemState({ connection: "connected", phase: "thinking", error: false }), "thinking");
  assert.equal(golemState({ connection: "connected", phase: null, error: true }), "failed");
  assert.equal(golemState({ connection: "connected", phase: null, error: false }), "idle");
});
