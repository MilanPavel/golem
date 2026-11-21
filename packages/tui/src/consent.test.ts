import assert from "node:assert/strict";
import { test } from "node:test";

import type { PendingConsent } from "@golem/view";

import { consentLines, consentRows } from "./consent.ts";
import { pressKey, type KeyPlace } from "./keys.ts";

const CONSENT: PendingConsent = {
  runId: "r1",
  modelProfile: "deepseek/deepseek-chat",
  model: "deepseek-chat",
  tier: "budget",
  why: "This turn does not fit qwen3.8:27b's 32K window, even after clearing old results.",
  estimatedUsd: 0.0213,
  alternatives: ["session", "once", "local"],
  caps: { sessionUsd: 0.5, dailyUsd: 2, spentSession: 0.1, spentToday: 0.42 },
  signal: null,
  helper: null,
  sent: [],
  notSent: [],
};

test("the band says the question, why, the model, the caps, and the keys", () => {
  assert.deepEqual(
    consentLines(CONSENT, 120).map((line) => line.text),
    [
      "Use a paid model for this?",
      "This turn does not fit qwen3.8:27b's 32K window, even after clearing old results.",
      "deepseek-chat · budget · ≈ $0.02 for this turn",
      "Session cap $0.50 · today $0.42 of $2.00",
      "a allow for this session · o just this once · l stay local",
    ],
  );
  assert.equal(consentRows(CONSENT), 5);
});

test("without caps the band has no caps row, and a spent cap lists two keys", () => {
  const spent: PendingConsent = { ...CONSENT, caps: null, alternatives: ["once", "local"] };
  assert.equal(consentRows(spent), 4);
  assert.deepEqual(
    consentLines(spent, 120).map((line) => line.text),
    [
      "Use a paid model for this?",
      CONSENT.why,
      "deepseek-chat · budget · ≈ $0.02 for this turn",
      "o just this once · l stay local",
    ],
  );
});

test("a long line is cut to the width", () => {
  for (const line of consentLines(CONSENT, 20)) assert.ok(line.text.length <= 20, line.text);
});

test("while the question waits, a, o and l answer it", () => {
  const place = {
    overlay: false,
    help: false,
    switcher: false,
    switcherConfirm: false,
    switcherFiltering: false,
    debug: false,
    draftEmpty: true,
    busy: true,
    connected: true,
    suggestions: false,
    history: false,
    consent: true,
  } satisfies KeyPlace;
  const press = (input: string, where: KeyPlace = place) =>
    pressKey(where, { name: null, input, ctrl: false, meta: false });
  assert.deepEqual(press("a"), { kind: "consent", answer: "session" });
  assert.deepEqual(press("o"), { kind: "consent", answer: "once" });
  assert.deepEqual(press("l"), { kind: "consent", answer: "local" });
  assert.deepEqual(press("x"), { kind: "ignore" });
  assert.notDeepEqual(press("a", { ...place, consent: false }), { kind: "consent", answer: "session" });
});

test("a helper's question names the helper, says what is sent and not sent, and the pager ends the keys", () => {
  const asked: PendingConsent = { ...CONSENT, helper: "worker \u00b7 upgrade httpx", sent: ["the brief"], notSent: ["this chat"] };
  const lines = consentLines(asked, 120, "1 of 2 \u00b7 tab next").map((line) => line.text);
  assert.equal(lines[0], "worker \u00b7 upgrade httpx asks \u00b7 Use a paid model for this?");
  assert.deepEqual(lines.slice(3, 5), ["Sent: the brief", "Not sent: this chat"]);
  assert.equal(lines.at(-1), "a allow for this session \u00b7 o just this once \u00b7 l stay local \u00b7 1 of 2 \u00b7 tab next");
  assert.equal(consentRows(asked), lines.length);
  assert.equal(consentRows(CONSENT), 5);
});
