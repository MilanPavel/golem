import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { ToolBlock } from "@golem/view";
import { ToolLine } from "../chat/transcript.tsx";
import { SessionDock } from "../composer/session-dock.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError } from "../../store/test-support.ts";
import type { DataResult } from "../../store/data.ts";
import { AddForm } from "./add-dialog.tsx";
import { ExtensionRow } from "./extension-row.tsx";
import { ResultTable } from "./result-table.tsx";
import { SAMPLE_BIG_PAGE_TWO, SAMPLE_BIG_RESULT, SAMPLE_EMPTY_RESULT, SAMPLE_SPEND_BY_MONTH, SAMPLE_SPEND_BY_NAME, SAMPLE_SUBSCRIPTIONS } from "./result-sample.ts";
import { SAMPLE_BANK, SAMPLE_INSPECT_FILES } from "./sample.ts";
import { SourcePage } from "./source-page.tsx";

beforeEach(() => {
  localStorage.clear();
});

const NBSP = " ";

function pageOf(offset: number, size: number): DataResult {
  const rows = SAMPLE_BIG_RESULT.rows.slice(0, size).map((row) => [Number(row[0]) + offset, ...row.slice(1)]);
  return { result_id: "r_a91", source: "bank", columns: SAMPLE_BIG_RESULT.columns, rows, total_rows: 18302, truncated: false, elapsed_ms: 0 };
}

test("a result shows its columns with their types, the rows and how many there are", () => {
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} />);
  const grid = screen.getByRole("table");
  expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["name" + "VARCHAR", "months" + "INTEGER", "per_month" + "DECIMAL(10,2)", "total" + "DECIMAL(10,2)", "last_charge" + "DATE"]);
  expect(within(grid).getAllByRole("row")).toHaveLength(10);
  expect(screen.getByText("table · 9 rows · from @bank")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("9 rows");
});

test("numbers are right-aligned, NULL is dimmed and a long text is cut with its full value on hover and on a press", async () => {
  const user = userEvent.setup();
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} />);
  const adobe = screen.getByRole("row", { name: /Adobe CC/ });
  const cells = within(adobe).getAllByRole("cell");
  expect(cells[1]?.className).toContain("text-right");
  expect(cells[0]?.className).toContain("text-left");
  expect(cells[3]?.textContent).toBe("693");
  expect(within(screen.getByRole("row", { name: /Netflix/ })).getAllByRole("cell")[3]?.textContent).toBe("139.9");
  const notes = screen.getByRole("row", { name: /Notes app/ });
  const dim = within(notes).getAllByText("NULL");
  expect(dim).toHaveLength(2);
  expect(dim[0]?.className).toContain("text-faint");
  const cut = within(notes).getByRole("button", { name: /Notes app, a plan/ });
  expect(cut.textContent?.endsWith("…")).toBe(true);
  expect(cut.getAttribute("title")).toContain("so it is cut");
  await user.click(cut);
  expect(cut.textContent).toContain("so it is cut");
});

test("Next, Previous and the page size ask data.result.page for the right rows", async () => {
  const user = userEvent.setup();
  const onPage = vi.fn(async ({ offset = 0, limit = 50 }) => pageOf(offset, limit));
  render(<ResultTable table={SAMPLE_BIG_RESULT} onPage={onPage} />);
  expect(screen.getByRole("status").textContent).toBe(`1–50 of 18${NBSP}302 rows`);
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`51–100 of 18${NBSP}302 rows`));
  expect(onPage).toHaveBeenLastCalledWith({ result_id: "r_a91", offset: 50, limit: 50 });
  await user.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`1–50 of 18${NBSP}302 rows`));
  expect(onPage).toHaveBeenLastCalledWith({ result_id: "r_a91", offset: 0, limit: 50 });
  await user.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "200");
  await waitFor(() => expect(onPage).toHaveBeenLastCalledWith({ result_id: "r_a91", offset: 0, limit: 200 }));
  expect(within(screen.getByRole("combobox", { name: "Rows per page" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["50", "200", "1000"]);
});

test("a page that cannot be read says why and keeps the rows it has", async () => {
  const user = userEvent.setup();
  const onPage = vi.fn(async () => {
    throw rpcError(-32602, "That result is no longer kept.");
  });
  render(<ResultTable table={SAMPLE_BIG_RESULT} onPage={onPage} />);
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect((await screen.findByRole("alert")).textContent).toBe("That result is no longer kept.");
  expect(screen.getAllByRole("row")).toHaveLength(51);
});

test("a result with no rows says so", () => {
  render(<ResultTable table={SAMPLE_EMPTY_RESULT} />);
  expect(screen.getByText("The query returned no rows.")).toBeTruthy();
});

test("sorting a column sorts the loaded page and says so", async () => {
  const user = userEvent.setup();
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} />);
  const firstNames = () => screen.getAllByRole("row").slice(1, 4).map((row) => within(row).getAllByRole("cell")[0]?.textContent);
  await user.click(screen.getByRole("button", { name: /^total/ }));
  expect(screen.getByRole("columnheader", { name: /^total/ }).getAttribute("aria-sort")).toBe("ascending");
  expect(firstNames()).toEqual(["Gym towel service", "NYT digital", "iCloud 200 GB"]);
  expect(screen.getByRole("status").textContent).toContain("sorted on this page");
  await user.click(screen.getByRole("button", { name: /^total/ }));
  expect(firstNames()).toEqual(["Adobe CC", "Fit24 gym", "Netflix"]);
  await user.click(screen.getByRole("button", { name: /^total/ }));
  expect(screen.getByRole("status").textContent).not.toContain("sorted");
});

test("the chart button shows only for a text or date column with numbers", async () => {
  const user = userEvent.setup();
  const view = render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} />);
  expect(screen.queryByRole("group", { name: "Show as" })).toBeNull();
  view.unmount();
  const bars = render(<ResultTable table={SAMPLE_SPEND_BY_NAME} />);
  await user.click(screen.getByRole("button", { name: "chart" }));
  expect(screen.getByRole("img", { name: "Bar chart of total by name, 7 bars" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "table" }));
  expect(screen.getByRole("table")).toBeTruthy();
  bars.unmount();
  render(<ResultTable table={SAMPLE_SPEND_BY_MONTH} />);
  await user.click(screen.getByRole("button", { name: "chart" }));
  expect(screen.getByRole("img", { name: "Line chart of spent by month, 11 points" })).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Chart" }), "earned");
  expect(screen.getByRole("img", { name: "Line chart of earned by month, 11 points" })).toBeTruthy();
});

test("the line about what the model saw shows only when rows were withheld, and expands to the stub", async () => {
  const user = userEvent.setup();
  const view = render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} />);
  expect(screen.queryByText("The model saw only the row count and column names")).toBeNull();
  view.unmount();
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} rowsWithheld />);
  expect(screen.getByText("The model saw only the row count and column names")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show what it saw" }));
  expect(screen.getByText(/result r_7f2: 9 rows × 5 cols, shown to the user\./)).toBeTruthy();
});

function tool(over: Partial<ToolBlock> = {}): ToolBlock {
  return { callId: "t1", name: "data_query", args: { source: "bank", sql: "select * from t" }, status: "done", summary: "18 302 rows", preview: "id | payee", table: SAMPLE_BIG_RESULT, ...over };
}

function inPage(node: React.ReactNode, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  const fake = fakeClient();
  setup?.(fake);
  const page = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  page.start();
  render(<PageProvider page={page}>{node}</PageProvider>);
  return fake;
}

test("a data_query tool block opens into the table, and paging in it calls data.result.page", async () => {
  const user = userEvent.setup();
  const fake = inPage(<ul><ToolLine tool={tool({ rowsWithheld: true })} defaultOpen /></ul>, ({ raw }) => {
    raw.pageDataResult.mockResolvedValue({ ...pageOf(50, 50), rows: SAMPLE_BIG_PAGE_TWO.rows });
  });
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.queryByText("id | payee")).toBeNull();
  expect(screen.getByText("The model saw only the row count and column names")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(fake.raw.pageDataResult).toHaveBeenCalledWith("r_a91", 50, 50));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("51–100"));
});

test("Export opens a dialog with the format and a path in Downloads, and writes with those", async () => {
  const user = userEvent.setup();
  const onExport = vi.fn(async ({ path }: { path: string }) => ({ path: `/home/you/${path.slice(2)}`, rows: 9 }));
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} onExport={onExport} />);
  await user.click(screen.getByRole("button", { name: /Export/ }));
  const dialog = await screen.findByRole("dialog", { name: "Export the result" });
  const path = within(dialog).getByLabelText("Path") as HTMLInputElement;
  expect(path.value).toMatch(/^~\/Downloads\/bank-\d{4}-\d{2}-\d{2}\.csv$/);
  await user.selectOptions(within(dialog).getByLabelText("Format"), "parquet");
  expect(path.value).toMatch(/^~\/Downloads\/bank-\d{4}-\d{2}-\d{2}\.parquet$/);
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
  expect(onExport).toHaveBeenCalledWith({ result_id: "r_7f2", path: path.value, format: "parquet" });
  expect((await within(dialog).findByRole("status")).textContent).toMatch(/^✓ Wrote 9 rows to \/home\/you\/Downloads\/bank-/);
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a typed path keeps its name when the format changes, and its own ending wins over the picker", async () => {
  const user = userEvent.setup();
  const onExport = vi.fn(async ({ path }: { path: string }) => ({ path, rows: 9 }));
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} onExport={onExport} />);
  await user.click(screen.getByRole("button", { name: /Export/ }));
  const dialog = await screen.findByRole("dialog");
  const path = within(dialog).getByLabelText("Path");
  await user.clear(path);
  await user.type(path, "~/Documents/subs.csv");
  await user.selectOptions(within(dialog).getByLabelText("Format"), "json");
  expect((path as HTMLInputElement).value).toBe("~/Documents/subs.json");
  await user.clear(path);
  await user.type(path, "~/Documents/subs.parquet");
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  await waitFor(() => expect(onExport).toHaveBeenCalledWith({ result_id: "r_7f2", path: "~/Documents/subs.parquet", format: "parquet" }));
});

test("a refused export says why in a sentence and can be tried again", async () => {
  const user = userEvent.setup();
  const onExport = vi.fn().mockRejectedValueOnce(new Error("/a.csv already exists. golem does not overwrite a file.")).mockResolvedValueOnce({ path: "/b.csv", rows: 9 });
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} onExport={onExport} />);
  await user.click(screen.getByRole("button", { name: /Export/ }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe("/a.csv already exists. golem does not overwrite a file.");
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  await within(dialog).findByRole("status");
  expect(onExport).toHaveBeenCalledTimes(2);
});

test("Excel without its add-on shows the one-time download, and Export works again after it", async () => {
  const user = userEvent.setup();
  const onExport = vi.fn().mockResolvedValueOnce({ path: "", rows: 0, needs_extension: "excel" }).mockResolvedValueOnce({ path: "/a.xlsx", rows: 9 });
  const onInstall = vi.fn(async () => {});
  render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} onExport={onExport} onInstallExtension={onInstall} />);
  await user.click(screen.getByRole("button", { name: /Export/ }));
  const dialog = await screen.findByRole("dialog");
  await user.selectOptions(within(dialog).getByLabelText("Format"), "xlsx");
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  const get = await within(dialog).findByRole("button", { name: "Get it (one-time download)" });
  expect(within(dialog).getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(true);
  expect(onInstall).not.toHaveBeenCalled();
  await user.click(get);
  await waitFor(() => expect(onInstall).toHaveBeenCalledWith("excel"));
  await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Get it (one-time download)" })).toBeNull());
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  await within(dialog).findByRole("status");
  expect(onExport).toHaveBeenCalledTimes(2);
});

test("a result with no connection has no Export button, and a tool block's table exports through the page's client", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<ResultTable table={SAMPLE_SUBSCRIPTIONS} />);
  expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
  unmount();
  const fake = inPage(<ul><ToolLine tool={tool()} defaultOpen /></ul>, ({ raw }) => {
    raw.exportDataResult.mockResolvedValue({ path: "/home/you/Downloads/a.csv", rows: 18302 });
  });
  await user.click(screen.getByRole("button", { name: /Export/ }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  await waitFor(() => expect(fake.raw.exportDataResult).toHaveBeenCalledWith("r_a91", expect.stringMatching(/^~\/Downloads\/bank-/), "csv"));
});

test("a tool block without a table keeps showing its preview", () => {
  render(<ul><ToolLine tool={tool({ table: undefined })} defaultOpen /></ul>);
  expect(screen.getByText("id | payee")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

test("the add-on button downloads only when pressed, then runs the follow-up; a failure says why and can be retried", async () => {
  const user = userEvent.setup();
  const onInstall = vi.fn().mockRejectedValueOnce(new Error("No network.")).mockResolvedValueOnce(undefined);
  const onDone = vi.fn();
  render(<ExtensionRow name="excel" onInstall={onInstall} onDone={onDone} />);
  expect(onInstall).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Get it (one-time download)" }));
  expect((await screen.findByRole("alert")).textContent).toContain("No network.");
  expect(onDone).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Get it (one-time download)" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(onInstall).toHaveBeenCalledWith("excel");
  expect(onInstall).toHaveBeenCalledTimes(2);
});

test("the add dialog offers the download for a location that needs an add-on, and checks again after it", async () => {
  const user = userEvent.setup();
  const onInspect = vi
    .fn()
    .mockResolvedValueOnce({ ...SAMPLE_INSPECT_FILES, tables: [], sample: {}, needs_extension: "excel", notes: ["Reading Excel files needs the Excel add-on."] })
    .mockResolvedValueOnce(SAMPLE_INSPECT_FILES);
  const onInstallExtension = vi.fn().mockResolvedValue(undefined);
  render(<AddForm inline folder={null} onInspect={onInspect} onInstallExtension={onInstallExtension} onAdd={() => new Promise(() => {})} onAdded={() => {}} onCancel={() => {}} onOpenMcp={() => {}} initial={{ step: "where", kind: "files", path: "~/Documents/budget.xlsx" }} />);
  await user.click(screen.getByRole("button", { name: "Check" }));
  await user.click(await screen.findByRole("button", { name: "Get it (one-time download)" }));
  await waitFor(() => expect(onInstallExtension).toHaveBeenCalledWith("excel"));
  await waitFor(() => expect(onInspect).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Get it (one-time download)" })).toBeNull());
});

test("a source page whose source needs an add-on offers the download", async () => {
  const user = userEvent.setup();
  const onInstallExtension = vi.fn().mockResolvedValue(undefined);
  render(
    <SourcePage
      source={{ ...SAMPLE_BANK, needs_extension: "excel" }}
      described={null}
      notes={{ state: "loading" }}
      tab="tables"
      onTab={() => {}}
      onAsk={() => {}}
      onRun={() => {}}
      onLoadProfile={() => Promise.reject(new Error("no"))}
      onBrowse={() => Promise.reject(new Error("no"))}
      onAskView={() => {}}
      onSaveNotes={() => Promise.resolve("")}
      onDraftNotes={() => Promise.resolve("")}
      onPrivacy={() => Promise.resolve()}
      onWatch={() => Promise.resolve()}
      onRemove={() => Promise.resolve()}
      onInstallExtension={onInstallExtension}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Get it (one-time download)" }));
  expect(onInstallExtension).toHaveBeenCalledWith("excel");
});

test("@ in the composer lists the data sources, Tab picks one and the message is sent as typed", async () => {
  const user = userEvent.setup();
  const fake = fakeClient();
  fake.raw.listData.mockResolvedValue({
    sources: [
      { name: "bank", kind: "files", scope: "user", location: "~/b", privacy: "local", status: "ready" },
      { name: "shop_dev", kind: "postgres", scope: "user", location: "postgres://x", privacy: "open", status: "ready" },
    ],
  });
  const page = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <SessionDock sessionId="a" />
    </PageProvider>,
  );
  const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  expect(fake.raw.listData).not.toHaveBeenCalled();
  await user.type(box, "how much did I spend on @ba");
  const list = await screen.findByRole("listbox", { name: "Data sources" });
  const options = within(list).getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["@bankdata source"]);
  await act(async () => {
    await user.keyboard("{Tab}");
  });
  expect(box.value).toBe("how much did I spend on @bank ");
  expect(screen.queryByRole("listbox", { name: "Data sources" })).toBeNull();
});
