import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's saved queries section shows Save query, both dialogs, the tab with a run open, a failed run the empty tab, the routine dialog, chips and Inbox posts, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { unmount } = render(<Gallery only="data-saved-queries" />);
    const region = (name: string) => within(screen.getByRole("region", { name: `${name}, ${theme}` }));
    expect(region("Save query, on a chat result").getByRole("button", { name: /Save query/ })).toBeTruthy();
    expect((region("Save dialog").getByLabelText("Name") as HTMLInputElement).value).toBe("Spending by month");
    expect(region("Save dialog").getByText(/~\/\.golem\/data\/bank\/queries\.toml/)).toBeTruthy();
    expect(region("Save dialog, name taken").getByRole("alert").textContent).toContain('Replace "Spending by month"?');
    const tab = region("Queries tab, a run open");
    expect(tab.getByText("Ran now · 11 rows · 38 ms")).toBeTruthy();
    expect(tab.getByText("last run failed")).toBeTruthy();
    expect(region("Queries tab, remove asked").getByRole("alertdialog", { name: "Remove Subscriptions" })).toBeTruthy();
    expect(region("Queries tab, empty").getByText(/A saved query is a named question/)).toBeTruthy();
    expect(region("Edit dialog, after Try").getByText("2 rows · 31 ms")).toBeTruthy();
    expect(region("Edit dialog, Try failed").getByRole("alert").textContent).toContain('"amout" not found');
    expect(region("New query dialog").queryByRole("button", { name: "Remove" })).toBeNull();
    const withRoutines = region("Queries tab, with routines");
    expect(withRoutines.getByRole("button", { name: /Open the routine spending/ })).toBeTruthy();
    expect(withRoutines.getAllByRole("button", { name: /^Routine for / }).length).toBeGreaterThan(0);
    expect(region("Routine dialog").getByText('New routine for "Big payments this week"')).toBeTruthy();
    expect(region("Routine dialog, new file").getByText("~/Documents/bank")).toBeTruthy();
    expect(region("Routine dialog, failed").getByRole("alert")).toBeTruthy();
    expect(region("Chips on a query row").getAllByRole("button")).toHaveLength(3);
    expect(within(screen.getByRole("list", { name: `Inbox post, rows, ${theme}` })).getByText("IKEA PRAHA")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: `Inbox post, failed, ${theme}` })).getByRole("alert").textContent).toContain("amout");
    unmount();
  }
});
