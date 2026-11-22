import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { IDLE_SETUP, MODELS_CASES, NO_ACTIONS, NO_PULLS, SHEET_CASES } from "../features/settings/models/models-sample.ts";
import { ModelsView } from "../features/settings/models/models-view.tsx";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state and theme: axe is slow in jsdom, and a loop in one test outgrows the timeout on CI.
for (const theme of ["slip", "kiln"] as const) {
  for (const { label } of MODELS_CASES) {
    test(`the gallery's Models page shows "${label}" in ${theme}, and passes axe`, async () => {
      showTheme(theme);
      render(<Gallery />);
      const region = screen.getByRole("region", { name: `Models, ${label}` });
      const page = within(region);
      expect(page.getByRole("group", { name: "Providers" })).toBeTruthy();
      expect(page.queryByRole("textbox")).toBeNull();
      if (label === "Not set up") expect(page.getByText("golem auth set google")).toBeTruthy();
      if (label === "oMLX") expect(page.getByText(/Support is planned/)).toBeTruthy();
      if (label === "Ollama downloading and removing") {
        expect(page.getByRole("progressbar")).toBeTruthy();
        expect(page.getByText(/Remove qwen3.8:27b from Ollama/)).toBeTruthy();
      }
      await expectAxeClean(region, DIALOG_RULES);
    });
  }
  for (const { label, props } of SHEET_CASES) {
    test(`the "${label}" sheet of Models in ${theme} passes axe`, async () => {
      showTheme(theme);
      render(<ModelsView {...props} pulls={NO_PULLS} setup={IDLE_SETUP} actions={NO_ACTIONS} />);
      const sheet = await screen.findByRole("dialog");
      await expectAxeClean(sheet, DIALOG_RULES);
    });
  }
}
