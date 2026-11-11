import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

const palettes = [
  ["Palette, all commands", "Commands"],
  ["Palette, filtered", "Commands"],
  ["Palette, Send row", "Commands"],
  ["Palette, no composer", "Commands"],
  ["Key list", "Keys"],
] as const;

for (const theme of ["slip", "kiln"] as const) {
  for (const [label, name] of palettes) {
    test(`the gallery's ${label} in ${theme} passes axe`, async () => {
      showTheme(theme);
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name });
      if (label === "Palette, filtered") expect(within(dialog).getAllByRole("option")[0]?.textContent).toContain("/model");
      if (label === "Palette, Send row") expect(within(dialog).getByRole("option").textContent).toBe('Send "explain this repo"');
      if (label === "Palette, no composer") expect(dialog.textContent).toContain("Open a session or the start page to run commands.");
      await expectAxeClean(dialog, DIALOG_RULES);
    });
  }
}
