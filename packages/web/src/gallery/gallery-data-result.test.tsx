import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Data result section shows the table, a page, a sort, both charts, the withheld line, the export form and its approval, and the add-on, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { unmount } = render(<Gallery only="data-result" />);
    const region = (name: string) => within(screen.getByRole("region", { name: `${name}, ${theme}` }));
    expect(region("Result, table").getByText("table · 9 rows · from @bank")).toBeTruthy();
    expect(region("Result, paged").getByRole("status").textContent).toContain("51–100 of 18");
    expect(region("Result, sorted").getByRole("status").textContent).toContain("sorted on this page");
    expect(region("Result, chart bar").getByRole("img", { name: /Bar chart of total by name/ })).toBeTruthy();
    expect(region("Result, chart line").getByRole("img", { name: /Line chart of spent by month/ })).toBeTruthy();
    expect(region("Result, rows withheld").getByText(/shown to the user\./)).toBeTruthy();
    expect(region("Result, truncated").getByText(/the query had more rows than were kept/)).toBeTruthy();
    expect(region("Result, empty").getByText("The query returned no rows.")).toBeTruthy();
    expect(region("Result, page failed").getByRole("alert")).toBeTruthy();
    expect(region("Add-on to download").getByRole("button", { name: "Get it (one-time download)" })).toBeTruthy();
    expect((region("Export, start").getByLabelText("Path") as HTMLInputElement).value).toBe("~/Downloads/bank-2026-11-26.csv");
    expect(region("Export, Excel needs the add-on").getByRole("button", { name: "Get it (one-time download)" })).toBeTruthy();
    expect(region("Export, file exists").getByRole("alert").textContent).toContain("already exists");
    expect(region("Export, written").getByRole("status").textContent).toContain("Wrote 9 rows to /Users/you/Downloads/bank-2026-11-26.csv.");
    expect(region("Export approval").getByText("golem wants to write a file")).toBeTruthy();
    expect(region("Export approval").getByText(/@bank stays as it is: read-only/)).toBeTruthy();
    unmount();
  }
});
