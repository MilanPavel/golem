import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

for (const theme of ["slip", "kiln"] as const) {
  for (const label of ["Tune view", "Tune view, a model that is not the session's"]) {
    test(`the gallery's "${label}" in ${theme} lists every option and passes axe`, async () => {
      showTheme(theme);
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
      expect(await within(dialog).findAllByRole("slider")).toHaveLength(6);
      expect(within(dialog).getByRole("radiogroup", { name: "Keep loaded" })).toBeTruthy();
      expect(within(dialog).getByRole("radio", { name: "Creative" })).toBeTruthy();
      expect(dialog.textContent).toContain("+0.0 GB · fits");
      await expectAxeClean(dialog, DIALOG_RULES);
    });
  }
}

for (const theme of ["slip", "kiln"] as const) {
  for (const [label, text] of [
    ["Tune view, try again", null],
    ["Tune view, no question to try", "Ask something first, then try again."],
    ["Tune view, chat running", "Wait for the answer, then try again."],
    ["Tune view, a try streaming", "A mutex lets one thread hold a resource"],
    ["Tune view, a try done", "The others wait their turn."],
    ["Tune view, a try failed", "The model did not answer."],
  ] as const) {
    test(`the gallery's "${label}" in ${theme} shows Try again and passes axe`, async () => {
      showTheme(theme);
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
      const button = (await within(dialog).findByRole("button", { name: "Try again with these settings" })) as HTMLButtonElement;
      expect(button.disabled).toBe(label === "Tune view, no question to try" || label === "Tune view, chat running");
      if (text !== null) expect(dialog.textContent).toContain(text);
      if (label.includes("a try")) expect(within(dialog).getByRole("link", { name: "Open the try session" })).toBeTruthy();
      await expectAxeClean(dialog, DIALOG_RULES);
    });
  }
}

for (const theme of ["slip", "kiln"] as const) {
  for (const [label, values] of [["Tune view, a thinking model", ["Model default", "off", "on"]], ["Tune view, thinking levels", ["Model default", "low", "medium", "high"]]] as const) {
    test(`the gallery's "${label}" in ${theme} has a think radio group and passes axe`, async () => {
      showTheme(theme);
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
      const group = await within(dialog).findByRole("radiogroup", { name: "Think" });
      expect(within(group).getAllByRole("radio").map((item) => item.textContent)).toEqual([...values]);
      await expectAxeClean(dialog, DIALOG_RULES);
    });
  }
}
