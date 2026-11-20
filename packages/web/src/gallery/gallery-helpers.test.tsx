import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's helper section shows three leads: helpers working, one asks, all done", () => {
  showTheme("slip");
  render(<Gallery />);
  const panel = within(screen.getByRole("complementary", { name: "Sessions with helpers, slip" }));
  // Only the three leads are rows.
  expect(panel.getAllByRole("link")).toHaveLength(3);
  const working = panel.getByRole("link", { name: /Map the daemon modules/ });
  expect(working.querySelectorAll("[data-square=working]")).toHaveLength(2);
  const asks = panel.getByRole("link", { name: /Check the retry code/ });
  expect(asks.querySelectorAll("[data-square=asking]")).toHaveLength(1);
  expect(asks.querySelectorAll("[data-square=working]")).toHaveLength(1);
  const done = panel.getByRole("link", { name: /Read the ADRs/ });
  expect(done.querySelector("[data-square]")).toBeNull();
});

test("the gallery's helper card shows two working, one asking, one queued", () => {
  showTheme("slip");
  render(<Gallery />);
  const group = within(screen.getByRole("group", { name: "Helpers of Map the daemon modules, slip" }));
  expect(group.getByText("4 helpers · 1 asks you")).toBeTruthy();
  const states = [...document.querySelectorAll("[data-helper-block]")].map((block) => block.getAttribute("data-helper-block"));
  expect(states).toEqual(["working", "working", "asking", "queued"]);
  expect(group.getByRole("button", { name: "Stop explorer routing" })).toBeTruthy();
});
