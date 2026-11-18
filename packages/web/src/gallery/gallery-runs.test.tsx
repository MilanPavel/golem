import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Runs section shows the panel, the grouped list, and the banner for each trigger", () => {
  showTheme("slip");
  render(<Gallery />);
  const panel = within(screen.getByRole("complementary", { name: "Runs, slip" }));
  expect(panel.getByRole("list", { name: "Needs you" })).toBeTruthy();
  expect(within(screen.getByRole("complementary", { name: "Runs, empty, slip" })).getByText("Nothing has run yet.")).toBeTruthy();
  const list = within(screen.getByRole("region", { name: "Runs list, slip" }));
  expect(list.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Needs you (1)", "Running (1)", "Today (2)", "Earlier (3)"]);
  const banners = within(screen.getByRole("region", { name: "Routine banners, slip" }));
  const text = banners.getAllByRole("region", { name: /^Routine run, / }).map((banner) => banner.textContent ?? "");
  expect(text).toHaveLength(3);
  expect(text[0]).toContain("by schedule");
  expect(text[0]).toContain("1 approval waiting");
  expect(text[1]).toContain("by you");
  expect(text[2]).toContain("by new file receipt-0412.pdf");
});
