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
  why: "The brief needs a bigger window.",
  estimatedUsd: 0.0213,
  alternatives: ["session", "once", "local"],
  caps: null,
  signal: null,
  helper: "reviewer · the diff",
  agent: "reviewer",
  sent: ["the brief"],
  notSent: [],
  brief: "Check the diff for races.\nReturn findings.",
  diffArtifactId: "a1",
};

const texts = (lines: { text: string }[]) => lines.map((line) => line.text);

test("the brief shows behind s, with the diff's first lines, and a reviewer reads Review locally", () => {
  const closed = texts(consentLines(CONSENT, 120));
  assert.equal(closed.at(-1), "a allow for this session · o just this once · l review locally · s show");
  assert.ok(!closed.includes("brief:"));
  const diff = { state: "ready", text: "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n", size: 29 } as const;
  const open = texts(consentLines(CONSENT, 120, null, { open: true, diff }));
  assert.deepEqual(open.slice(4, 6), ["brief:", "Check the diff for races."]);
  assert.ok(open.includes("diff:") && open.includes("+y"));
  assert.ok(open.at(-1)?.endsWith("s hide"));
  assert.equal(consentRows(CONSENT, { open: true, diff }), open.length);
});

test("the diff reads loading, failed, and not asked", () => {
  const rows = (diff: Parameters<typeof consentLines>[3]) => texts(consentLines(CONSENT, 120, null, diff));
  assert.ok(rows({ open: true, diff: { state: "loading" } }).includes("diff: reading…"));
  assert.ok(rows({ open: true, diff: { state: "error" } }).includes("diff: could not be read"));
  const noDiff = texts(consentLines({ ...CONSENT, diffArtifactId: null }, 120, null, { open: true, diff: { state: "none" } }));
  assert.ok(!noDiff.some((text) => text.startsWith("diff")));
});

test("without a brief or diff there is no s key; other helpers and cloud-only setups keep their words", () => {
  const plain = texts(consentLines({ ...CONSENT, agent: "worker", brief: null, diffArtifactId: null }, 120));
  assert.equal(plain.at(-1), "a allow for this session · o just this once · l stay local");
  const cloud = texts(consentLines({ ...CONSENT, alternatives: ["session", "once"] }, 120));
  assert.ok(!cloud.at(-1)?.includes("local"));
});

test("a long brief is cut to a few rows", () => {
  const long = { ...CONSENT, brief: Array.from({ length: 20 }, (_, i) => `line ${String(i)}`).join("\n") };
  const open = texts(consentLines(long, 40, null, { open: true, diff: { state: "none" } }));
  assert.ok(open.some((text) => /^… \d+ more rows$/.test(text)));
});

test("s is a key only when there is something to show", () => {
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
  const press = (where: KeyPlace) => pressKey(where, { name: null, input: "s", ctrl: false, meta: false });
  assert.deepEqual(press({ ...place, consentShow: true }), { kind: "consent-show" });
  assert.notDeepEqual(press(place), { kind: "consent-show" });
});
