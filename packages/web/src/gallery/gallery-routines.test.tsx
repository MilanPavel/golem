import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Routines section shows the panel, a detail with History, and the empty state", () => {
  showTheme("slip");
  render(<Gallery />);
  const panel = within(screen.getByRole("complementary", { name: "Routines, slip" }));
  expect(panel.getByRole("link", { name: /morning-brief/ })).toBeTruthy();
  expect(within(screen.getByRole("complementary", { name: "Routines, empty, slip" })).getByText(/No routines yet/)).toBeTruthy();
  const detail = within(screen.getByRole("region", { name: "Routine detail, slip" }));
  expect(detail.getByRole("list", { name: "History" })).toBeTruthy();
  const empty = within(screen.getByRole("region", { name: "Routines, nothing set up, slip" }));
  expect(empty.getByRole("heading", { name: "Nothing runs by itself yet" })).toBeTruthy();
});
