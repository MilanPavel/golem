import axe from "axe-core";
import { afterEach, expect } from "vitest";

/** A dialog is not a page, so it has no landmarks to check. */
export const DIALOG_RULES = { region: { enabled: false } };

/**
 * Axe on one node. A dialog test runs it on the dialog, not on the whole gallery: axe reads computed
 * styles node by node, which is slow in jsdom, so the time grows with the size of the tree.
 */
export async function expectAxeClean(node: Element, extraRules: Record<string, { enabled: boolean }> = {}): Promise<void> {
  const results = await axe.run(node, {
    resultTypes: ["violations"],
    // jsdom does not compute colors, so contrast cannot be checked here.
    // tokens.test.ts checks every text and background pair in both themes.
    rules: { "color-contrast": { enabled: false }, ...extraRules },
  });
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
