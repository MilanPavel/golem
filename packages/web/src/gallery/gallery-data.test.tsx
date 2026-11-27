import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Data section shows the panel, each tab of a source, and the steps of the add dialog, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { unmount } = render(<Gallery only="data" />);
    const region = (name: string) => within(screen.getByRole("region", { name: `${name}, ${theme}` }));
    const panel = within(screen.getByRole("complementary", { name: `Data, ${theme}` }));
    expect(panel.getAllByText(/^(This project|Yours)/).map((node) => node.textContent)).toEqual(["This project · shop-api", "Yours"]);
    expect(within(screen.getByRole("complementary", { name: `Data, empty, ${theme}` })).getByText(/No sources yet/)).toBeTruthy();
    expect(within(screen.getByRole("complementary", { name: `Data, loading, ${theme}` })).getByText("Loading sources.")).toBeTruthy();
    expect(within(screen.getByRole("complementary", { name: `Data, not available yet, ${theme}` })).getByText(/not available yet/)).toBeTruthy();
    expect(region("Source, rows open").getByText("Sample rows · you and every model")).toBeTruthy();
    expect(region("Source, rows local").getByText("Sample rows · you and local models")).toBeTruthy();
    expect(region("Source, schema only").getByRole("button", { name: "Show sample rows" })).toBeTruthy();
    expect(region("Source, not trusted").getAllByText(/trust this folder to use it/).length).toBeGreaterThan(0);
    expect(region("Source, notes").getByLabelText("Notes of bank")).toBeTruthy();
    expect(region("Source, notes, not available yet").getByText("Notes come in a later version of golem.")).toBeTruthy();
    expect(region("Source, queries").getByRole("list", { name: "Saved queries" })).toBeTruthy();
    expect(region("Source, queries, none").getByText("Save a query from a chat result and it shows here.")).toBeTruthy();
    expect(region("Source, settings").getByRole("button", { name: "Remove source" })).toBeTruthy();
    expect(region("Source, settings, built in").queryByRole("button", { name: "Remove source" })).toBeNull();
    expect(region("Add dialog, kind").getByRole("radio", { name: /Files or a folder/ })).toBeTruthy();
    expect(region("Add dialog, files, checked").getByText("36 files match, one table: transactions.")).toBeTruthy();
    expect(region("Add dialog, files, not found").getByRole("alert").textContent).toContain("No files match");
    expect(region("Add dialog, database, tested").getByText("goes to the macOS Keychain, never to a file or a model")).toBeTruthy();
    expect(region("Add dialog, database, tested").getByText("connected · PostgreSQL 17.2 · 3 tables · 1 schema")).toBeTruthy();
    expect(region("Add dialog, database, not tested").getByText(/You have not tested the connection/)).toBeTruthy();
    expect(region("Add dialog, database, login can write").getByText(/This login can change data/)).toBeTruthy();
    expect(region("Add dialog, database, could not connect").getByRole("alert").textContent).toContain("password authentication failed");
    expect(region("Source, settings, database").getByText("password in the macOS Keychain · golem/data/shop_prod")).toBeTruthy();
    expect(region("Source, settings, database").getByRole("button", { name: "Change password" })).toBeTruthy();
    expect(region("Add dialog, privacy, files").getByText("suggested")).toBeTruthy();
    expect(region("Add dialog, privacy, database, add failed").getByRole("alert").textContent).toContain("password authentication failed");
    unmount();
  }
});
