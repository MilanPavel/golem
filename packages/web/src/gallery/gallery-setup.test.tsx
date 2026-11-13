import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { FORM_CASES } from "../features/setup/sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state and theme: axe is slow in jsdom, and a loop in one test outgrows the timeout on CI.
for (const theme of ["slip", "kiln"] as const) {
  for (const { label } of FORM_CASES) {
    test(`the gallery's Setup page shows "${label}" in ${theme}, and passes axe`, async () => {
      showTheme(theme);
      render(<Gallery />);
      const region = screen.getByRole("region", { name: `Setup, ${label}` });
      const group = within(region);
      const status = group.getAllByRole("status")[0]?.textContent;
      const rows = group.getByRole("list", { name: "Setup" });
      const tinted = (tone: string) => [...rows.querySelectorAll("li")].filter((item) => item.className.includes(tone));
      if (label === "All set") {
        expect(status).toBe("All set");
        expect(group.getByRole("group", { name: "golem" }).textContent).toContain("Homebrew · /opt/homebrew/bin/golem");
        expect(tinted("-soft")).toHaveLength(0);
      }
      if (label === "Ollama stopped") {
        expect(status).toContain("not running");
        expect(tinted("bg-wait-soft")).toHaveLength(1);
        expect(group.getByRole("button", { name: "Start Ollama" })).toBeTruthy();
      }
      if (label === "One failing row") {
        expect(tinted("bg-deny-soft")).toHaveLength(1);
        expect(group.getByRole("button", { name: "Install Ollama" })).toBeTruthy();
      }
      if (label === "A key line open") {
        const line = within(group.getByRole("group", { name: "Anthropic key" }));
        expect(line.getByText("golem auth set anthropic")).toBeTruthy();
        expect(line.getByText("The page never takes a key. Paste it in a terminal.")).toBeTruthy();
      }
      expect(group.queryByRole("button", { name: /Update|Reveal|Restart/ })).toBeNull();
      await expectAxeClean(region, DIALOG_RULES);
    });
  }
}
