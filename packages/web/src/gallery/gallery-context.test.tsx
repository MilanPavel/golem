import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { CONTEXT_CASES } from "../features/settings/context-sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state: axe is slow in jsdom, and a loop in one test outgrows the timeout on CI.
for (const { label, errors } of CONTEXT_CASES) {
    test(`the gallery's Context page shows "${label}" and passes axe`, async () => {
      showTheme("slip");
      render(<Gallery only="settings-context" />);
      const region = screen.getByRole("region", { name: `Context, ${label}` });
      const group = within(region);
      expect(group.getByRole("region", { name: "Right now" })).toBeTruthy();
      expect(group.getByText("Local models only")).toBeTruthy();
      expect(group.getByText("All models")).toBeTruthy();
      if (label === "Auto with a hosted model") expect(group.getByRole("radio", { name: /^qwen\/qwen3-235b · 128K$/ })).toBeTruthy();
      if (label === "Fixed") expect(group.getByText(/One size for every local model, and golem does not check it/)).toBeTruthy();
      if (label === "Ollama's") expect(group.getByText("golem sends no window, so Ollama picks its own.")).toBeTruthy();
      if (label === "No window") {
        expect(group.queryByRole("radio", { name: /· 128K$/ })).toBeNull();
        expect(group.getAllByText("The chart shows once the window size is known.").length).toBeGreaterThan(0);
      }
      if (Object.keys(errors).length > 0) expect(group.getAllByRole("alert").length).toBeGreaterThan(0);
      await expectAxeClean(region, DIALOG_RULES);
    });
}
