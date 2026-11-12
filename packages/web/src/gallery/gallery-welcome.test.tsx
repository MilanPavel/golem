import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { TOOLS_CASES } from "../features/setup/tools-sample.ts";
import { WELCOME_CASES } from "../features/welcome/sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// Every state in both themes: the page is drawn the same in both, only the tokens change.
for (const theme of ["slip", "kiln"] as const) {
  // One test per case: axe is slow in jsdom, and a loop of every case in one test outgrew the timeout on CI.
  // A timed-out test leaves axe running, so the tests after it failed with "Axe is already running".
  for (const { label } of WELCOME_CASES) {
    test(`the gallery's welcome page shows "${label}" in ${theme}, and passes axe`, async () => {
      showTheme(theme);
      render(<Gallery />);
      const group = screen.getByRole("region", { name: `Welcome, ${label}` });
      expect(within(group).getByRole("list", { name: "Setup steps" })).toBeTruthy();
      if (label === "Engine, installing Ollama") expect(group.textContent).toContain("==> Fetching ollama");
      if (label === "Model, default gone") expect(group.textContent).toContain("is no longer installed");
      if (label === "Ready, model downloading") expect(within(group).getByRole("heading", { name: "Almost ready." })).toBeTruthy();
      await expectAxeClean(group, DIALOG_RULES);
    });
  }

  for (const { label } of TOOLS_CASES) {
    test(`the gallery's Tools panel shows "${label}" in ${theme}, and passes axe`, async () => {
      showTheme(theme);
      render(<Gallery />);
      const group = screen.getByRole("region", { name: label });
      if (label === "Tools, the offer") expect(within(group).getByRole("button", { name: "Add 3" })).toBeTruthy();
      if (label === "Tools, GitHub ticked") expect((within(group).getByLabelText("GitHub token") as HTMLInputElement).type).toBe("password");
      if (label === "Tools, adding") {
        expect(group.textContent).toContain("installing Node");
        expect(within(group).getByRole("progressbar", { name: "Installing Node" }).getAttribute("aria-valuenow")).toBe("41");
        expect(group.textContent).toContain("failed · The token was refused (401)");
      }
      if (label === "Tools, Settings card") expect(group.textContent).toContain("Tools · 1 server");
      await expectAxeClean(group, DIALOG_RULES);
    });
  }

  test(`the gallery's empty screen with the setup strip in ${theme} passes axe`, async () => {
    showTheme(theme);
    render(<Gallery />);
    const group = screen.getByRole("group", { name: "Empty screen, setup left" });
    expect(group.textContent).toContain("Setup isn't finished.");
    expect(within(group).getByRole("button", { name: "Finish setup" })).toBeTruthy();
    await expectAxeClean(group, DIALOG_RULES);
  });
}
