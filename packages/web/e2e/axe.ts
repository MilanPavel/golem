import axe from "axe-core";
import type { Page } from "@playwright/test";

/** Serious and critical axe violations in the whole page, one line each. */
export async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const results = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: Document) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[] }> } }).axe.run;
    return run(document);
  });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}
