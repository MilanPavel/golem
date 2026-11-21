import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_TEMPLATE, agentActions, agentKey, agentProblemText, definitionNote, deleteQuestion, hasUnsavedText, replacesLine, selectionAfter } from "./agents-edit.ts";
import { definitionLines } from "./agents-view.ts";

test("the template has the keys of a file and a prompt", () => {
  const keys = definitionLines(AGENT_TEMPLATE).flatMap((line) => (line.kind === "key" ? [line.key] : []));
  assert.deepEqual(keys, ["name", "description", "model", "tools", "max-calls", "max-seconds", "max-answer-chars", "asks"]);
  assert.match(AGENT_TEMPLATE, /^model: cheapest$/m);
  assert.match(AGENT_TEMPLATE, /^asks: false$/m);
  assert.ok(AGENT_TEMPLATE.endsWith("return.\n"));
});

test("a problem says its line when it has one", () => {
  assert.equal(agentProblemText({ message: 'there is no tool named "read_files"', line: 5 }), 'Line 5: there is no tool named "read_files"');
  assert.equal(agentProblemText({ message: "the prompt is empty", line: null }), "the prompt is empty");
});

test("the actions follow where the agent comes from", () => {
  assert.deepEqual(agentActions("bundled", true), { copy: true, edit: false, remove: false });
  assert.deepEqual(agentActions("user", true), { copy: false, edit: true, remove: true });
  assert.deepEqual(agentActions("user", false), { copy: false, edit: false, remove: true });
  assert.deepEqual(agentActions("project", true), { copy: false, edit: false, remove: false });
});

test("a copy says it replaces the bundled agent, and delete says it comes back", () => {
  assert.equal(replacesLine("explorer", ["bundled"]), "replaces the bundled explorer");
  assert.equal(replacesLine("triage", []), null);
  assert.equal(replacesLine("docs", ["user"]), null);
  assert.equal(deleteQuestion(["bundled"]), "Delete your copy and go back to the bundled one?");
  assert.equal(deleteQuestion([]), "Delete this agent?");
});

test("the note under the file says what the file is", () => {
  assert.match(definitionNote("bundled", []) ?? "", /make your own copy/);
  assert.match(definitionNote("user", ["bundled"]) ?? "", /bundled one back/);
  assert.match(definitionNote("user", []) ?? "", /next helper/);
  assert.equal(definitionNote("project", []), null);
});

test("selection after a save or a delete is the agent the daemon names, else the first", () => {
  assert.equal(agentKey({ origin: "user", name: "triage" }), "user/triage");
  assert.equal(selectionAfter({ origin: "bundled", name: "explorer" }), "bundled/explorer");
  assert.equal(selectionAfter(null), null);
  assert.equal(selectionAfter(undefined), null);
});

test("only changed text is unsaved", () => {
  assert.equal(hasUnsavedText("a", "a"), false);
  assert.equal(hasUnsavedText("a ", "a"), true);
});
