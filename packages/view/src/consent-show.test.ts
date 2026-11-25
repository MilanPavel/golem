import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat } from "./chat-state.ts";
import { consentAnswerLabel, consentShowable } from "./consent.ts";
import { inboxItems } from "./inbox.ts";

function ev(type: string, data: Record<string, unknown>): ChatEvent {
  return { seq: 1, session_id: "s", run_id: "r1", ts: "t", type, data } as ChatEvent;
}

const ASKED = {
  model_profile: "deepseek/deepseek-chat",
  provider: "deepseek",
  model: "deepseek-chat",
  tier: "budget",
  why: "The brief needs a bigger window.",
  estimated_usd: 0.0213,
  alternatives: ["once", "local"],
  helper_id: "h1",
  agent: "reviewer",
  label: "the diff",
  brief: "Check the diff.",
  diff_artifact_id: "a1",
};

test("a helper's question carries its brief and diff artifact", () => {
  const state = reduceChat(emptyChat, ev("route.consent.needed", ASKED));
  assert.ok(state.consent);
  assert.equal(state.consent.brief, "Check the diff.");
  assert.equal(state.consent.diffArtifactId, "a1");
  assert.deepEqual(consentShowable(state.consent), { brief: "Check the diff.", diffArtifactId: "a1" });
});

test("without a brief or diff there is nothing to show", () => {
  const bare: Record<string, unknown> = { ...ASKED };
  delete bare["brief"];
  delete bare["diff_artifact_id"];
  const state = reduceChat(emptyChat, ev("route.consent.needed", bare));
  assert.ok(state.consent);
  assert.equal(state.consent.brief, null);
  assert.equal(consentShowable(state.consent), null);
  assert.equal(consentShowable({ brief: "  ", diffArtifactId: null }), null);
  assert.deepEqual(consentShowable({ brief: null, diffArtifactId: "a1" }), { brief: null, diffArtifactId: "a1" });
});

test("a reviewer's local answer reads Review locally; the rest keep their words", () => {
  const state = reduceChat(emptyChat, ev("route.consent.needed", ASKED));
  assert.ok(state.consent);
  assert.equal(consentAnswerLabel(state.consent, "local"), "Review locally");
  assert.equal(consentAnswerLabel(state.consent, "once"), "Just this once");
  const worker = reduceChat(emptyChat, ev("route.consent.needed", { ...ASKED, agent: "worker" }));
  assert.ok(worker.consent);
  assert.equal(consentAnswerLabel(worker.consent, "local"), "Stay local");
});

test("the Inbox item of a helper's question carries the brief and the diff artifact", () => {
  const [item] = inboxItems(
    [
      {
        session_id: "lead",
        status: "waiting",
        pending_items: [
          { kind: "consent", since: "2026-11-16T09:55:00Z", brief: "Check it.", diff_artifact_id: "a1", helper: { session_id: "h1", agent: "reviewer", index: 0 } },
        ],
      },
    ],
    Date.parse("2026-11-16T10:00:00Z"),
  );
  assert.equal(item?.brief, "Check it.");
  assert.equal(item?.diffArtifactId, "a1");
});
