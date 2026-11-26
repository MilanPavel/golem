import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Workflows section shows the panels and a detail for each tab and state", () => {
  showTheme("slip");
  render(<Gallery />);
  const panel = within(screen.getByRole("complementary", { name: "Workflows, slip" }));
  expect(panel.getByText("This project")).toBeTruthy();
  expect(panel.getByText("Yours")).toBeTruthy();
  expect(panel.getByRole("link", { name: /broken/ }).textContent).toContain("ImportError");
  expect(within(screen.getByRole("complementary", { name: "Workflows, two projects, slip" })).getByRole("link", { name: /deploy/ }).textContent).toContain("not trusted");
  expect(within(screen.getByRole("complementary", { name: "Workflows, empty, slip" })).getByText(/No workflows yet/)).toBeTruthy();
  expect(within(screen.getByRole("complementary", { name: "Workflows, loading, slip" })).getByText("Loading workflows.")).toBeTruthy();
  const overview = within(screen.getByRole("region", { name: "Workflow detail, Overview, slip" }));
  expect(overview.getByRole("table", { name: "Inputs" })).toBeTruthy();
  expect(overview.getByRole("list", { name: "Steps" })).toBeTruthy();
  const code = within(screen.getByRole("region", { name: "Workflow detail, Code, slip" }));
  expect(code.getByRole("textbox", { name: "Code of pr_digest" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Workflow detail, Runs, slip" })).getByRole("list", { name: "Runs" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Workflow detail, Runs, none yet, slip" })).getByText("No runs yet.")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Workflow detail, broken, slip" })).getByRole("alert").textContent).toContain("ImportError");
});
