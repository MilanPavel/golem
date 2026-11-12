import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { WELCOME_CASES } from "../features/welcome/sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One theme per test, and every state in it: the page is drawn the same in both, only the tokens change.
for (const theme of ["slip", "kiln"] as const) {
  test(`the gallery's welcome page shows every step and state in ${theme}, and passes axe`, async () => {
    showTheme(theme);
    render(<Gallery />);
    for (const { label } of WELCOME_CASES) {
      const group = screen.getByRole("region", { name: `Welcome, ${label}` });
      expect(within(group).getByRole("list", { name: "Setup steps" })).toBeTruthy();
      if (label === "Engine, installing Ollama") expect(group.textContent).toContain("==> Fetching ollama");
      if (label === "Model, default gone") expect(group.textContent).toContain("is no longer installed");
      if (label === "Ready, model downloading") expect(within(group).getByRole("heading", { name: "Almost ready." })).toBeTruthy();
      await expectAxeClean(group, DIALOG_RULES);
    }
  });

  test(`the gallery's empty screen with the setup strip in ${theme} passes axe`, async () => {
    showTheme(theme);
    render(<Gallery />);
    const group = screen.getByRole("group", { name: "Empty screen, setup left" });
    expect(group.textContent).toContain("Setup isn't finished.");
    expect(within(group).getByRole("button", { name: "Finish setup" })).toBeTruthy();
    await expectAxeClean(group, DIALOG_RULES);
  });
}
