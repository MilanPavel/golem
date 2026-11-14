import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's MCP servers section shows the catalog cards and the import list, nothing picked to start", () => {
  showTheme("slip");
  render(<Gallery />);
  const catalog = within(screen.getByRole("region", { name: "MCP servers, Catalog" }));
  expect(catalog.getByRole("heading", { name: "GitHub" })).toBeTruthy();
  expect(catalog.getByRole("heading", { name: "Another server" })).toBeTruthy();
  const none = within(screen.getByRole("region", { name: "MCP servers, Import with nothing picked" }));
  expect(none.getByText("0 selected")).toBeTruthy();
  expect((none.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  const some = within(screen.getByRole("region", { name: "MCP servers, Import with some picked" }));
  expect(some.getByRole("button", { name: "Import 2" })).toBeTruthy();
});
