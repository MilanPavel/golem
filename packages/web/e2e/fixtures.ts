import { test as base, expect } from "@playwright/test";

import { Rig } from "./harness.ts";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

interface Fixtures {
  /** Starts and owns processes; everything is stopped and every temp dir removed afterwards. */
  rig: Rig;
  /** Patterns for console errors a test causes on purpose, such as a stopped gateway. */
  tolerate: RegExp[];
}

/** `test` with the rig, and a failure on any console error or CSP violation in the page. */
export const test = base.extend<Fixtures>({
  rig: async ({}, run) => {
    const rig = new Rig();
    try {
      await run(rig);
    } finally {
      await rig.cleanup();
    }
  },
  tolerate: async ({}, run) => {
    await run([]);
  },
  // Depends on rig, so the page is checked before the processes stop.
  page: async ({ page, rig, tolerate }, run) => {
    void rig;
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // The browser asks for a favicon on its own, and the page has none.
      if (msg.location().url.endsWith("/favicon.ico")) return;
      errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations?.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    await run(page);
    const violations = await page.evaluate(() => window.__cspViolations ?? []).catch(() => []);
    expect(violations, "CSP violations").toEqual([]);
    expect(
      errors.filter((e) => !tolerate.some((t) => t.test(e))),
      "console errors",
    ).toEqual([]);
  },
});

export { expect };
