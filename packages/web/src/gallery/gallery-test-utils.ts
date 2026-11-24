import axe from "axe-core";
import { afterEach, expect } from "vitest";

/** The end of the latest axe run, whether it passed or failed. */
let lastRun: Promise<void> = Promise.resolve();

/** A dialog is not a page, so it has no landmarks to check. */
export const DIALOG_RULES = { region: { enabled: false } };

/**
 * Axe on one node. A dialog test runs it on the dialog, not on the whole gallery: axe reads computed
 * styles node by node, which is slow in jsdom, so the time grows with the size of the tree.
 */
export async function expectAxeClean(node: Element, extraRules: Record<string, { enabled: boolean }> = {}): Promise<void> {
  // axe-core refuses to start while a run is active, and a test that timed out leaves its run going. Wait for
  // the previous run to end, so one slow section is one failure and not a chain of "Axe is already running".
  const previous = lastRun;
  const run = (async () => {
    await previous;
    return axe.run(node, {
      resultTypes: ["violations"],
      // jsdom does not compute colors, so contrast cannot be checked here.
      // tokens.test.ts checks every text and background pair in both themes.
      rules: { "color-contrast": { enabled: false }, ...extraRules },
    });
  })();
  lastRun = run.then(
    () => undefined,
    () => undefined,
  );
  const results = await run;
  expect(results.violations).toEqual([]);
}

/** `initialView()` in gallery.tsx reads `?theme=`, so a test renders one theme and its buttons stay unique. */
export function showTheme(theme: "slip" | "kiln"): void {
  history.replaceState(null, "", `?theme=${theme}`);
}

/** Call once per test file: puts the URL back after each test. */
export function resetThemeAfterEach(): void {
  afterEach(() => {
    history.replaceState(null, "", location.pathname);
  });
}
