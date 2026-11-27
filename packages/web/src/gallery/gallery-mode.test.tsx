import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test(`the gallery's mode chips open a menu of the modes and pass axe`, async () => {
  showTheme("slip");
  const user = userEvent.setup();
  render(<Gallery only="dock" />);
  expect(screen.getByRole("button", { name: "Permission mode: autopilot. Change it." })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Permission mode: balanced, the default. Change it." })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Permission mode: careful. Change it." }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4);
  await expectAxeClean(menu, DIALOG_RULES);
});
