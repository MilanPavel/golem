import { expect, test } from "vitest";
import { SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_PROPOSAL, SAMPLE_PR_DIGEST_STEPS } from "./sample.ts";
import { compareSteps, lineDiff, stepUses, suggestedKey } from "./text.ts";

test("a step uses the steps in its after, with their numbers, and a key is made from its title", () => {
  const step = (id: string, title: string, after: string[] = []) => ({ id, kind: "step", title, lines: [1, 1] as [number, number], after });
  const steps = [step("a", "Read the list"), step("b", "Save it", ["a", "gone"])];
  expect(stepUses(steps, steps[1]!)).toEqual([{ title: "Read the list", number: 1 }]);
  expect(stepUses(steps, steps[0]!)).toEqual([]);
  expect(suggestedKey(steps[1]!)).toBe("save-it");
  expect(suggestedKey(step("c", "!!"))).toBe("step");
});

test("a proposal's steps are new when the saved outline lacks them and changed when a field differs", () => {
  const found = compareSteps(SAMPLE_PR_DIGEST_STEPS, SAMPLE_PR_DIGEST_PROPOSAL.steps ?? []);
  expect([...found.entries()]).toEqual([
    ["s2", "new"],
    ["s3", "changed"],
  ]);
  expect(compareSteps(SAMPLE_PR_DIGEST_STEPS, SAMPLE_PR_DIGEST_STEPS).size).toBe(0);
});

test("a line diff counts added and removed lines and folds the unchanged ones", () => {
  const diff = lineDiff(SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_PROPOSAL.code);
  expect(diff.added).toBe(2);
  expect(diff.removed).toBe(1);
  expect(diff.rows.filter((row) => row.kind === "add").map((row) => row.line)).toEqual([14, 17]);
  expect(diff.rows.some((row) => row.kind === "skip")).toBe(true);
  expect(diff.rows.find((row) => row.kind === "del")?.line).toBeNull();
});

test("a line diff of two equal texts has no changes", () => {
  const diff = lineDiff("a\nb\n", "a\nb\n");
  expect([diff.added, diff.removed]).toEqual([0, 0]);
  expect(diff.rows.every((row) => row.kind === "skip")).toBe(true);
});
