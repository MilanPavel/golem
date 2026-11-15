import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { KEYS_CASES } from "../features/settings/keys-sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state and theme: axe is slow in jsdom, and a loop in one test outgrows the timeout on CI.
for (const theme of ["slip", "kiln"] as const) {
  for (const { label } of KEYS_CASES) {
    test(`the gallery's API keys page shows "${label}" in ${theme}, and passes axe`, async () => {
      showTheme(theme);
      render(<Gallery />);
      const region = screen.getByRole("region", { name: `API keys, ${label}` });
      const group = within(region);
      expect(group.getByRole("list", { name: "Model providers" })).toBeTruthy();
      if (label === "Fresh install") {
        expect(group.getAllByText("missing").length).toBeGreaterThan(0);
        expect(group.queryByText("saved", { selector: "span" })).toBeNull();
      }
      if (label === "No MCP keys") {
        expect(group.queryByRole("list", { name: "MCP servers" })).toBeNull();
        expect(group.getByText(/No MCP server needs a key/)).toBeTruthy();
      }
      if (label === "Drawer open") {
        expect(group.getByText("golem auth remove openai")).toBeTruthy();
      }
      if (label === "Drawer open, key from the environment") {
        expect(group.getByText(/Unset it there to remove/)).toBeTruthy();
      }
      expect(group.queryByRole("textbox")).toBeNull();
      await expectAxeClean(region, DIALOG_RULES);
    });
  }
}
