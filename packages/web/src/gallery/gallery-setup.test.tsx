import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { FORM_CASES } from "../features/setup/sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state: axe is slow in jsdom, and a loop in one test outgrows the timeout on CI.
for (const { label } of FORM_CASES) {
  test(`the gallery's Setup page shows "${label}", and passes axe`, async () => {
    showTheme("slip");
    render(<Gallery only="setup-form" />);
    const region = screen.getByRole("region", { name: `Setup, ${label}` });
    const group = within(region);
    const rows = group.getByRole("list", { name: "Health" });
    const tinted = (tone: string) => [...rows.querySelectorAll("li")].filter((item) => item.className.includes(tone));
    if (label === "All set") {
      expect(group.getByRole("group", { name: "golem" }).textContent).toContain("/opt/homebrew/bin/golem");
      expect(tinted("-soft")).toHaveLength(0);
    }
    if (label === "Ollama stopped") {
      expect(group.getByText("Ollama isn't running, so models can't load.")).toBeTruthy();
      expect(tinted("bg-wait-soft")).toHaveLength(1);
      expect(group.getByRole("button", { name: "Start Ollama" })).toBeTruthy();
    }
    if (label === "One failing row") {
      expect(tinted("bg-deny-soft")).toHaveLength(1);
      expect(group.getByRole("button", { name: "Install Ollama" })).toBeTruthy();
    }
    expect(group.queryByRole("button", { name: /Update|Reveal|Restart/ })).toBeNull();
    await expectAxeClean(region, DIALOG_RULES);
  });
}
