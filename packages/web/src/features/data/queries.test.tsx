import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { DataResult, DataSavedQuery } from "../../store/data.ts";
import { QueriesTab, type QueriesTabProps } from "./queries-tab.tsx";
import { ResultTable } from "./result-table.tsx";
import { SAMPLE_SPEND_BY_MONTH } from "./result-sample.ts";
import { SAMPLE_BANK } from "./sample.ts";

const NOW = new Date(2026, 10, 27, 12, 0);
const SPENT: DataSavedQuery = {
  name: "Spending by month",
  description: "Money out per month this year",
  sql: "select month, sum(amount) from t group by 1",
  last_run_at: new Date(2026, 10, 27, 9, 14).toISOString(),
  last_rows: 11,
  last_ms: 38,
};
const BROKEN: DataSavedQuery = {
  name: "Big payments",
  sql: "select amout from t",
  last_run_at: new Date(2026, 10, 27, 9, 0).toISOString(),
  last_error: 'column "amout" not found\nCandidate bindings: amount',
};

const RESULT: DataResult = {
  result_id: "res_9",
  source: "bank",
  columns: [
    { name: "month", type: "VARCHAR" },
    { name: "spent", type: "DOUBLE" },
  ],
  rows: [
    ["2026-09", 2090.4],
    ["2026-10", 2611.05],
  ],
  total_rows: 2,
  truncated: false,
  elapsed_ms: 38,
};

function tab(over: Partial<QueriesTabProps> = {}): QueriesTabProps {
  return {
    source: SAMPLE_BANK,
    queries: [SPENT, BROKEN],
    onRun: vi.fn().mockResolvedValue(RESULT),
    onTry: vi.fn().mockResolvedValue(RESULT),
    onAsk: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    now: NOW,
    ...over,
  };
}

test("a row shows the name, what it answers, one line of SQL and the last run", () => {
  render(<QueriesTab {...tab()} />);
  const row = within(screen.getByRole("list", { name: "Saved queries" })).getAllByRole("listitem")[0] as HTMLElement;
  expect(row.textContent).toContain("Spending by month");
  expect(row.textContent).toContain("Money out per month this year");
  expect(row.textContent).toContain("select month, sum(amount) from t group by 1");
  expect(row.textContent).toContain("last run today 09:14");
  expect(row.textContent).toContain("11 rows · 38 ms");
});

test("a failed last run shows the engine's first line in the deny colour, and Run is still there", () => {
  render(<QueriesTab {...tab()} />);
  const row = screen.getByRole("list", { name: "Saved queries" }).querySelector('[data-query="Big payments"]') as HTMLElement;
  expect(row.textContent).toContain("last run failed");
  const why = within(row).getByText('column "amout" not found');
  expect(why).toBeTruthy();
  expect(why.parentElement?.className).toContain("text-deny");
  expect((within(row).getByRole("button", { name: "Run Big payments" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Run runs the saved query by name and opens the result under the row, with Chart, Export and a close", async () => {
  const user = userEvent.setup();
  const onRun = vi.fn().mockResolvedValue(RESULT);
  render(<QueriesTab {...tab({ onRun, onExport: vi.fn() })} />);
  await user.click(screen.getByRole("button", { name: "Run Spending by month" }));
  expect(onRun).toHaveBeenCalledWith("Spending by month");
  expect(await screen.findByText("Ran now · 2 rows · 38 ms")).toBeTruthy();
  const row = screen.getByRole("list", { name: "Saved queries" }).querySelector('[data-query="Spending by month"]') as HTMLElement;
  expect(within(row).getByRole("table")).toBeTruthy();
  expect(within(row).getByRole("button", { name: /Export/ })).toBeTruthy();
  await user.click(within(row).getByRole("button", { name: "Close the result" }));
  expect(within(row).queryByRole("table")).toBeNull();
});

test("a run that fails says why on the row", async () => {
  const onRun = vi.fn().mockRejectedValue(new Error('column "amout" not found'));
  render(<QueriesTab {...tab({ queries: [SPENT], onRun })} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Run Spending by month" }));
  expect(await screen.findByText("last run failed")).toBeTruthy();
  expect(screen.getByText('column "amout" not found')).toBeTruthy();
});

test("Ask in chat hands the query over", async () => {
  const onAsk = vi.fn();
  render(<QueriesTab {...tab({ onAsk })} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Ask in chat: Spending by month" }));
  expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ name: "Spending by month" }));
});

test("Edit with Try shows the first rows, then the engine's error, and Save renames from the old name", async () => {
  const user = userEvent.setup();
  const onTry = vi.fn().mockResolvedValueOnce(RESULT).mockRejectedValueOnce(new Error('column "spnt" not found'));
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<QueriesTab {...tab({ onTry, onSave })} />);
  await user.click(screen.getByRole("button", { name: "More for Spending by month" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText('Edit "Spending by month"')).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: /Try/ }));
  expect(await within(dialog).findByText("2 rows · 38 ms")).toBeTruthy();
  expect(within(dialog).getByText(/611\.05/)).toBeTruthy();
  const sql = within(dialog).getByLabelText("SQL");
  await user.clear(sql);
  await user.type(sql, "select spnt from t");
  await user.click(within(dialog).getByRole("button", { name: /Try/ }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain('column "spnt" not found');
  const name = within(dialog).getByLabelText("Name");
  await user.clear(name);
  await user.type(name, "Monthly spend");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith({
    source: "bank",
    name: "Monthly spend",
    sql: "select spnt from t",
    description: "Money out per month this year",
    previous_name: "Spending by month",
  });
});

test("New query has no Remove, and Save sends no previous name", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<QueriesTab {...tab({ queries: [], onSave })} />);
  expect(screen.getByText("A saved query is a named question you ask often, like spending by month.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /New query/ }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByRole("button", { name: "Remove" })).toBeNull();
  await user.type(within(dialog).getByLabelText("Name"), "Totals");
  await user.type(within(dialog).getByLabelText("SQL"), "select 1");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ source: "bank", name: "Totals", sql: "select 1" }));
});

test("Remove asks once on the row before it deletes", async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn().mockResolvedValue(undefined);
  render(<QueriesTab {...tab({ onRemove })} />);
  await user.click(screen.getByRole("button", { name: "More for Spending by month" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
  expect(onRemove).not.toHaveBeenCalled();
  const ask = await screen.findByRole("alertdialog", { name: "Remove Spending by month" });
  await user.click(within(ask).getByRole("button", { name: "Keep it" }));
  expect(onRemove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "More for Spending by month" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onRemove).toHaveBeenCalledWith("Spending by month");
});

test("Remove in the Edit dialog asks once too", async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn().mockResolvedValue(undefined);
  render(<QueriesTab {...tab({ onRemove })} />);
  await user.click(screen.getByRole("button", { name: "More for Spending by month" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));
  expect(onRemove).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/Remove "Spending by month" from bank\?/)).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(onRemove).toHaveBeenCalledWith("Spending by month"));
});

const WITH_SQL = { ...SAMPLE_SPEND_BY_MONTH, sql: "select month, spent, earned from totals" };

test("a result with SQL has Save query, and the dialog posts that SQL with a name from the question", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ResultTable table={WITH_SQL} save={{ scope: "user", question: "How much did I spend each month this year?", onSave }} />);
  await user.click(screen.getByRole("button", { name: /Save query/ }));
  const dialog = await screen.findByRole("dialog", { name: "Save this query" });
  expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Spend each month this year");
  expect(within(dialog).getByLabelText("The SQL that ran").textContent).toBe("select month, spent, earned from totals");
  expect(dialog.textContent).toContain("~/.golem/data/bank/queries.toml");
  await user.type(within(dialog).getByLabelText(/What it answers/), "Money out per month");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith({ source: "bank", name: "Spend each month this year", sql: "select month, spent, earned from totals", description: "Money out per month" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: /Saved/ })).toBeTruthy();
});

test("a taken name asks Replace and saves again with replace", async () => {
  const user = userEvent.setup();
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error('There is already a query called "Totals" in this source.'))
    .mockResolvedValueOnce(undefined);
  render(<ResultTable table={WITH_SQL} save={{ scope: "project", question: "Totals", onSave }} />);
  await user.click(screen.getByRole("button", { name: /Save query/ }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("in .golem/data/bank/queries.toml in this project");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain('Replace "Totals"?');
  await user.click(within(dialog).getByRole("button", { name: "Replace" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave).toHaveBeenLastCalledWith({ source: "bank", name: "Totals", sql: "select month, spent, earned from totals", replace: true });
});

test("a result with no SQL (kept before queries could be saved) has no Save query button", () => {
  render(<ResultTable table={SAMPLE_SPEND_BY_MONTH} save={{ scope: "user", question: null, onSave: vi.fn() }} />);
  expect(screen.queryByRole("button", { name: /Save query/ })).toBeNull();
});
