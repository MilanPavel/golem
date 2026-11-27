import assert from "node:assert/strict";
import { test } from "node:test";
import { describeModelWords, nameTakenWords, saveInWords, suggestFreeName, workflowFileName } from "./workflow-new.ts";

test("a typed name becomes a file name and a title, as the daemon does", () => {
  assert.deepEqual(workflowFileName("Weekly invoices"), { file: "weekly_invoices", title: "Weekly invoices" });
  assert.deepEqual(workflowFileName("weekly_invoices"), { file: "weekly_invoices", title: "Weekly invoices" });
  assert.deepEqual(workflowFileName("  Check my sites -- now! "), { file: "check_my_sites_now", title: "Check my sites -- now!" });
});

test("a name that cannot be a file name says why", () => {
  for (const bad of ["", "   ", "123 go", "!!!", "class", "x".repeat(61), "日本語"]) {
    assert.ok("problem" in workflowFileName(bad), bad);
  }
});

test("the next free number is suggested", () => {
  assert.equal(suggestFreeName("a", ["a", "a_2"]), "a_3");
  assert.equal(suggestFreeName("a", []), "a_2");
  assert.match(nameTakenWords("a", "a_2"), /Try a_2/);
});

test("the page says where the file goes and which model writes it", () => {
  assert.match(saveInWords(null), /~\/\.golem\/workflows/);
  assert.match(saveInWords("/p"), /\/p\/workflows/);
  assert.match(describeModelWords(null, "qwen"), /default model, qwen/);
  assert.match(describeModelWords("big", "qwen"), /big writes it/);
  assert.match(describeModelWords(null, null), /No model is set up/);
});
