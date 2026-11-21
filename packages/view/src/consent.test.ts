import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat, type PendingConsent } from "./chat-state.ts";
import { CONSENT_LABELS, CONSENT_TITLE, consentAnswers, consentCapsLine, consentLine, consentNotSentLine, consentReason, consentSentLine } from "./consent.ts";

function ev(type: string, data: Record<string, unknown>, run = "r1"): ChatEvent {
  return { seq: 1, session_id: "s", run_id: run, ts: "t", type, data } as ChatEvent;
}

const ASKED = {
  model_profile: "deepseek/deepseek-chat",
  provider: "deepseek",
  model: "deepseek-chat",
  tier: "budget",
  why: "This turn does not fit qwen3.8:27b's 32K window.",
  estimated_usd: 0.0213,
  alternatives: ["session", "once", "local"],
  caps: { session_usd: 0.5, daily_usd: 2.0, spent_session: 0.1, spent_today: 0.42 },
};

function asked(): PendingConsent {
  const state = reduceChat(emptyChat, ev("route.consent.needed", ASKED));
  assert.ok(state.consent);
  return state.consent;
}

test("route.consent.needed opens the question on the run, and the answer closes it", () => {
  let state = reduceChat(emptyChat, ev("run.started", {}));
  state = reduceChat(state, ev("route.consent.needed", ASKED));
  assert.equal(state.busy, true);
  assert.equal(state.runId, "r1");
  assert.deepEqual(state.consent, {
    runId: "r1",
    modelProfile: "deepseek/deepseek-chat",
    model: "deepseek-chat",
    tier: "budget",
    why: "This turn does not fit qwen3.8:27b's 32K window.",
    estimatedUsd: 0.0213,
    alternatives: ["session", "once", "local"],
    signal: null,
    helper: null,
    sent: [],
    notSent: [],
    caps: { sessionUsd: 0.5, dailyUsd: 2.0, spentSession: 0.1, spentToday: 0.42 },
  });
  state = reduceChat(state, ev("route.consent.answered", { answer: "once" }));
  assert.equal(state.consent, null);
  assert.equal(state.busy, true);
});

test("an open question is dropped when the run ends any way", () => {
  for (const [type, data] of [
    ["run.completed", {}],
    ["run.failed", { message: "x" }],
    ["run.cancelled", { reason: "user" }],
  ] as const) {
    const state = reduceChat(reduceChat(emptyChat, ev("route.consent.needed", ASKED)), ev(type, data));
    assert.equal(state.consent, null, type);
  }
});

test("a question without an estimate or caps keeps them null", () => {
  const bare: Record<string, unknown> = { ...ASKED };
  delete bare["estimated_usd"];
  delete bare["caps"];
  const state = reduceChat(emptyChat, ev("route.consent.needed", bare));
  assert.equal(state.consent?.estimatedUsd, null);
  assert.equal(state.consent?.caps, null);
});

test("the texts: title, buttons, model line and caps line", () => {
  assert.equal(CONSENT_TITLE, "Use a paid model for this?");
  assert.deepEqual(CONSENT_LABELS, {
    session: "Allow for this session",
    once: "Just this once",
    local: "Stay local",
  });
  const consent = asked();
  assert.equal(consentLine(consent), "deepseek-chat · budget · ≈ $0.02 for this turn");
  assert.equal(consentCapsLine(consent), "Session cap $0.50 · today $0.42 of $2.00");
  assert.deepEqual(consentAnswers(consent), ["session", "once", "local"]);
});

test("the model line leaves the estimate out when the price is unknown, and caps out when none is set", () => {
  const consent = { ...asked(), estimatedUsd: null, caps: null };
  assert.equal(consentLine(consent), "deepseek-chat · budget");
  assert.equal(consentCapsLine(consent), "");
});

test("a daily cap alone, and the answers of a spent cap", () => {
  const consent: PendingConsent = {
    ...asked(),
    alternatives: ["local", "once"],
    caps: { sessionUsd: null, dailyUsd: 2, spentSession: 0, spentToday: 2 },
  };
  assert.equal(consentCapsLine(consent), "today $2.00 of $2.00");
  assert.deepEqual(consentAnswers(consent), ["once", "local"]);
});

test("a question from a struggling model says so, and one before a turn keeps its words", () => {
  assert.equal(consentReason(asked()), ASKED.why);
  const state = reduceChat(
    emptyChat,
    ev("route.consent.needed", { ...ASKED, why: "a tool call written as text could not be read on small.", signal: "unread_text_call" }),
  );
  assert.ok(state.consent);
  assert.equal(state.consent.signal, "unread_text_call");
  assert.equal(
    consentReason(state.consent),
    "The model is struggling: a tool call written as text could not be read on small.",
  );
});

test("a helper's question names the helper and what is sent and not sent", () => {
  const data = { ...ASKED, helper_id: "h1", agent: "worker", label: "upgrade httpx", sent: ["the brief", "the diff, 212 lines"], not_sent: ["this chat"] };
  const state = reduceChat(emptyChat, ev("route.consent.needed", data));
  assert.ok(state.consent);
  assert.equal(state.consent.helper, "worker \u00b7 upgrade httpx");
  assert.equal(consentSentLine(state.consent), "Sent: the brief, the diff, 212 lines");
  assert.equal(consentNotSentLine(state.consent), "Not sent: this chat");
  const bare = reduceChat(emptyChat, ev("route.consent.needed", { ...data, label: null }));
  assert.equal(bare.consent?.helper, "worker");
});

test("a lead's own question has no helper and no sent lines", () => {
  const consent = asked();
  assert.equal(consent.helper, null);
  assert.equal(consentSentLine(consent), "");
  assert.equal(consentNotSentLine(consent), "");
});
