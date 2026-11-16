import assert from "node:assert/strict";
import { test } from "node:test";

import { applyComposer, closedDebug, COMMANDS } from "./commands.ts";
import type { KeyPlace } from "./keys.ts";
import { layoutMessages, type Span } from "./layout-chat.ts";
import { planOffered } from "./plan-offer.ts";
import { statusSegments } from "./status-label.ts";

import type { ChatMessage, PlanState } from "@golem/view";

const text = (spans: readonly Span[]) => spans.map((span) => span.text).join("");

const waiting: PlanState = {
  on: true,
  plan: { planId: "p", callId: "c1", title: "retry with backoff", steps: [{ text: "Add with_retry", files: ["src/fetch.py"] }], answered: false },
};

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
};

const none = { retry: false, install: false, setup: false };

test("/plan toggles, and /plan on and off set it", () => {
  assert.deepEqual(applyComposer(closedDebug, "/plan"), { kind: "plan", on: "toggle" });
  assert.deepEqual(applyComposer(closedDebug, "/plan on"), { kind: "plan", on: true });
  assert.deepEqual(applyComposer(closedDebug, "/plan off"), { kind: "plan", on: false });
  assert.equal(applyComposer(closedDebug, "/plan soon").kind, "unknown");
  assert.deepEqual(COMMANDS.find((command) => command.name === "/plan")?.choices, ["on", "off"]);
});

test("a plan call is drawn as plan rows, not a tool line", () => {
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    text: "",
    streaming: false,
    tools: [
      {
        callId: "c1",
        name: "propose_plan",
        status: "done",
        args: {
          title: "retry with backoff",
          steps: [
            { text: "Add with_retry to the fetcher", files: ["src/fetch.py"] },
            { text: "Test three failures", files: ["tests/test_fetch.py", "src/fetch.py"] },
          ],
        },
      },
    ],
  };
  const rows = layoutMessages([message], 80).map((line) => text(line.spans).trimEnd());
  assert.ok(rows.includes("◇ plan  retry with backoff"));
  assert.ok(rows.includes("  1. Add with_retry to the fetcher  src/fetch.py"));
  assert.ok(rows.includes("  2. Test three failures  tests/test_fetch.py · src/fetch.py"));
  assert.ok(rows.includes("  2 steps · 2 files"));
  assert.equal(rows.some((row) => row.includes("propose_plan")), false);
});

test("the status line shows ◇ plan while plan first is on", () => {
  const input = { connection: "connected", title: "t", model: "m", folder: "", messageCount: 0, uptimeSeconds: null };
  assert.equal(statusSegments({ ...input, plan: true }).find((segment) => segment.id === "plan")?.text, "◇ plan");
  assert.equal(statusSegments({ ...input }).find((segment) => segment.id === "plan")?.text ?? "", "");
});

test("Enter builds only while the newest plan waits and the composer is empty", () => {
  assert.equal(planOffered(waiting, place, none), true);
  assert.equal(planOffered(waiting, { ...place, draftEmpty: false }, none), false);
  assert.equal(planOffered(waiting, { ...place, busy: true }, none), false);
  assert.equal(planOffered(waiting, { ...place, approval: true }, none), false);
  assert.equal(planOffered(waiting, place, { ...none, retry: true }), false);
  assert.equal(planOffered({ ...waiting, plan: waiting.plan === null ? null : { ...waiting.plan, answered: true } }, place, none), false);
  assert.equal(planOffered({ on: true, plan: null }, place, none), false);
});
