import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldProblem, initialValues, inputFields, startInputs } from "./workflow-inputs.ts";
import { errorLine, triggerText, workflowGroups, workflowRowLine, workflowRunWords } from "./workflow-list.ts";

test("what starts a workflow, in words", () => {
  assert.equal(triggerText(null), "By hand");
  assert.equal(triggerText({ kind: "manual" }), "By hand");
  assert.equal(triggerText({ kind: "schedule", expr: "0 9 * * 1" }), "On a schedule: 0 9 * * 1");
  assert.equal(triggerText({ kind: "on_file", path: "inbox/" }), "When a file changes: inbox/");
});

test("a row says why a file cannot run, or what the workflow does", () => {
  const base = { id: "a", name: "a" };
  assert.equal(workflowRowLine({ ...base, state: "broken", error: "Traceback\n\n  ImportError: x\n" }), "ImportError: x");
  assert.equal(errorLine(""), "It did not load.");
  assert.equal(workflowRowLine({ ...base, state: "untrusted" }), "not trusted");
  assert.equal(workflowRowLine({ ...base, state: "ok", description: "\nDigest of PRs\nmore" }), "Digest of PRs");
  assert.equal(workflowRowLine({ ...base, state: "ok", description: "", trigger: { kind: "schedule", expr: "daily" } }), "On a schedule: daily");
});

test("groups: this project, several projects by folder, then yours", () => {
  const w = (name: string, project: string | null) => ({ id: name, name, state: "ok", project });
  assert.deepEqual(workflowGroups([w("a", "/r/one"), w("b", null)]).map((group) => [group.label, group.workflows.length]), [["This project", 1], ["Yours", 1]]);
  assert.deepEqual(workflowGroups([w("a", "/r/one"), w("b", "/r/two")]).map((group) => group.label), ["one", "two"]);
});

test("a run's state in words", () => {
  assert.deepEqual(["pending", "waiting", "running"].map(workflowRunWords), ["queued", "waiting for you", "running"]);
});

test("input fields: type, default, required, choices, and the start inputs", () => {
  const fields = inputFields([
    { name: "folder", type: "folder" },
    { name: "n", type: "int", default: "3" },
    { name: "mode", type: 'Literal["a", "b"]' },
    { name: "dry", type: "bool", default: "True" },
    { name: "note", default: '"hi"' },
  ]);
  assert.deepEqual(fields.map((field) => [field.kind, field.required]), [["folder", true], ["number", false], ["choice", true], ["bool", false], ["text", false]]);
  const values = initialValues(fields);
  assert.deepEqual(values, { folder: "", n: "3", mode: "", dry: "true", note: "hi" });
  assert.equal(fieldProblem(fields[0]!, ""), "Required.");
  assert.equal(fieldProblem(fields[1]!, "x"), "Enter a number.");
  assert.deepEqual(startInputs(fields, { ...values, folder: "/d", n: "" }), { folder: "/d", dry: true, note: "hi" });
});
