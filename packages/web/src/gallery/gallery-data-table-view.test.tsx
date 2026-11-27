import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Data table view section shows the profile as a list and as cards, and the rows loading, sorted and filtered, and one row open, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { unmount } = render(<Gallery only="data-table-view" />);
    const region = (name: string) => within(screen.getByRole("region", { name: `${name}, ${theme}` }));
    const list = region("Profile, list");
    expect(list.getByRole("list", { name: "Columns of titanic" }).querySelectorAll("li").length).toBe(12);
    expect(list.getByRole("img", { name: /^Age: .+ to .+/ })).toBeTruthy();
    expect(list.getByRole("button", { name: /^Survived 0 · no/ })).toBeTruthy();
    expect(list.getByText("unique, 1 … 891 · looks like a key")).toBeTruthy();
    expect(region("Profile, cards").getByRole("list", { name: "Columns of titanic" }).querySelectorAll("li").length).toBe(12);
    expect(region("Rows, loading").getByRole("status").textContent).toBe("reading the rows…");
    expect(region("Rows, first page").getByRole("status").textContent).toMatch(/^rows 1–\d+ of 891$/);
    expect(region("Rows, sorted and filtered").getByRole("status").textContent).toMatch(/of \d+ \(filtered from 891\)$/);
    expect(region("Rows, sorted and filtered").getByRole("button", { name: /Remove filter Sex = female/ })).toBeTruthy();
    expect(region("Rows, sorted and filtered").getByRole("columnheader", { name: /Fare/ }).getAttribute("aria-sort")).toBe("descending");
    expect(region("Rows, row detail").getByRole("complementary", { name: "Row 2" })).toBeTruthy();
    unmount();
  }
});
