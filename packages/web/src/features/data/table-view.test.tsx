import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError } from "../../store/test-support.ts";
import type { DataBrowseKeepResult, DataBrowseKeepView, DataBrowseResult, DataBrowseView } from "../../store/data.ts";
import type { DataTab } from "../../store/router.ts";
import { sidebarItemStore } from "../sidebar/sidebar-item.ts";
import { SAMPLE_BANK_DESCRIBED } from "./sample.ts";
import { EMPTY_VIEW, RowsBrowser, type RowsView } from "./rows-browser.tsx";
import { SourcePage } from "./source-page.tsx";
import { PASSENGER_COLUMNS, PASSENGERS, SAMPLE_PASSENGER_PROFILE, SAMPLE_TITANIC, SAMPLE_TITANIC_TABLE } from "./table-sample.ts";

const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };
const COLUMNS = PASSENGER_COLUMNS.map((column) => ({ name: column.name, type: column.type }));
const TOTAL = 2000;

beforeEach(() => {
  localStorage.clear();
  sidebarItemStore.set("sessions");
});
afterEach(() => {
  history.replaceState(null, "", "/");
  sidebarItemStore.set("sessions");
});

/** A page of a table of TOTAL rows, as the daemon answers: the whole table, `limit` rows from `offset`. */
function answer(view: DataBrowseView, total = TOTAL): DataBrowseResult {
  const offset = view.offset ?? 0;
  const limit = view.limit ?? 200;
  const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, at) => {
    const row = PASSENGERS[(offset + at) % PASSENGERS.length] ?? [];
    return [offset + at + 1, ...row.slice(1)];
  });
  return { columns: COLUMNS, rows, total_rows: total, elapsed_ms: 2 };
}

function Harness({ onBrowse, onAskView = () => {}, first = EMPTY_VIEW, tableRows = TOTAL }: { onBrowse: (table: string, view: DataBrowseView) => Promise<DataBrowseResult>; onAskView?: (text: string) => void; first?: RowsView; tableRows?: number }) {
  const [view, setView] = useState(first);
  return <RowsBrowser source="titanic" table="titanic" columns={COLUMNS} tableRows={tableRows} view={view} onView={setView} onBrowse={onBrowse} onAskView={onAskView} />;
}

/** Waits until the first page is in the grid. */
async function ready(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^rows /));
}

function rowsBrowse() {
  return vi.fn((_table: string, view: DataBrowseView) => Promise.resolve(answer(view)));
}

test("the grid asks for the first page, then for the pages the scroll position touches, and no others", async () => {
  const onBrowse = rowsBrowse();
  render(<Harness onBrowse={onBrowse} />);
  await waitFor(() => expect(onBrowse).toHaveBeenCalledTimes(1));
  expect(onBrowse.mock.calls[0]?.[1]).toMatchObject({ offset: 0, limit: 200 });
  expect(await screen.findByRole("status")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^rows 1–\d+ of 2 000$/));
  const grid = screen.getByRole("group", { name: /Rows of titanic/ });
  act(() => {
    fireEvent.scroll(grid, { target: { scrollTop: 32 * 450 } });
  });
  await waitFor(() => expect(onBrowse.mock.calls.map((call) => call[1].offset)).toContain(400));
  expect(onBrowse.mock.calls.map((call) => call[1].offset)).not.toContain(200);
  expect(await screen.findByText("451")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/^rows 451–\d+ of 2 000$/);
  // A scroll that straddles two pages asks for both.
  act(() => {
    fireEvent.scroll(grid, { target: { scrollTop: 32 * 190 } });
  });
  await waitFor(() => expect(onBrowse.mock.calls.map((call) => call[1].offset)).toContain(200));
});

test("rows that are still loading show grey placeholders", async () => {
  render(<Harness onBrowse={() => new Promise<never>(() => {})} />);
  const grid = await screen.findByRole("table", { name: "Rows of titanic" });
  expect(grid.querySelectorAll("tbody tr[aria-rowindex]").length).toBe(15);
  expect(grid.querySelectorAll('tbody span[aria-hidden="true"]').length).toBeGreaterThan(30);
  expect(screen.getByRole("status").textContent).toBe("reading the rows…");
});

test("a header click sorts across all rows: ascending, then descending, then not at all", async () => {
  const user = userEvent.setup();
  const onBrowse = rowsBrowse();
  render(<Harness onBrowse={onBrowse} />);
  await ready();
  const header = () => screen.getByRole("columnheader", { name: /Fare/ });
  await user.click(within(header()).getByRole("button"));
  await waitFor(() => expect(onBrowse.mock.calls.at(-1)?.[1]).toMatchObject({ sort: { column: "Fare", desc: false } }));
  expect(header().getAttribute("aria-sort")).toBe("ascending");
  await user.click(within(header()).getByRole("button"));
  await waitFor(() => expect(onBrowse.mock.calls.at(-1)?.[1]).toMatchObject({ sort: { column: "Fare", desc: true } }));
  expect(header().getAttribute("aria-sort")).toBe("descending");
  await user.click(within(header()).getByRole("button"));
  await waitFor(() => expect(header().getAttribute("aria-sort")).toBe("none"));
  await waitFor(() => expect(onBrowse.mock.calls.at(-1)?.[1]).not.toHaveProperty("sort"));
  // The page asks by names and values. There is no SQL in it.
  expect(JSON.stringify(onBrowse.mock.calls)).not.toMatch(/select|from titanic/i);
});

test("the search waits for the typing to stop, then asks across all rows, and a filter chip can be removed", async () => {
  const user = userEvent.setup();
  const onBrowse = rowsBrowse();
  render(<Harness onBrowse={onBrowse} first={{ ...EMPTY_VIEW, filters: [{ column: "Sex", op: "=", value: "female" }] }} />);
  await ready();
  expect(onBrowse.mock.calls[0]?.[1]).toMatchObject({ filters: [{ column: "Sex", op: "=", value: "female" }] });
  const calls = onBrowse.mock.calls.length;
  await user.type(screen.getByRole("searchbox", { name: "Find in text columns" }), "Ann");
  expect(onBrowse.mock.calls.length).toBe(calls);
  await waitFor(() => expect(onBrowse.mock.calls.at(-1)?.[1]).toMatchObject({ search: "Ann" }));
  await user.click(screen.getByRole("button", { name: "Remove filter Sex = female" }));
  await waitFor(() => expect(onBrowse.mock.calls.at(-1)?.[1]).toMatchObject({ filters: [] }));
  expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
});

test("the status says how many rows were filtered out of the whole table", async () => {
  render(<Harness onBrowse={(_table, view) => Promise.resolve(answer(view, 312))} tableRows={891} />);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("rows 1–15 of 312 (filtered from 891)"));
});

test("a row opens in a panel with every column; the arrows move, Enter opens and Escape closes", async () => {
  const user = userEvent.setup();
  render(<Harness onBrowse={rowsBrowse()} />);
  const grid = screen.getByRole("group", { name: /Rows of titanic/ });
  await ready();
  await ready();
  await user.click(document.querySelector('tr[aria-rowindex="3"]') as HTMLElement);
  const panel = await screen.findByRole("complementary", { name: "Row 3" });
  for (const column of COLUMNS) expect(within(panel).getByText(column.name)).toBeTruthy();
  expect(within(panel).getByText(String(PASSENGERS[2]?.[3]))).toBeTruthy();
  fireEvent.keyDown(grid, { key: "ArrowDown" });
  expect(screen.getByRole("complementary", { name: "Row 4" })).toBeTruthy();
  fireEvent.keyDown(grid, { key: "ArrowUp" });
  fireEvent.keyDown(grid, { key: "ArrowUp" });
  expect(screen.getByRole("complementary", { name: "Row 2" })).toBeTruthy();
  fireEvent.keyDown(grid, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(screen.getByRole("complementary", { name: "Row 2" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close row" }));
  expect(screen.queryByRole("complementary")).toBeNull();
});

test("Ask about this view hands the filter and the sort over as one line of SQL, and sends nothing", async () => {
  const user = userEvent.setup();
  const onAskView = vi.fn();
  const onBrowse = rowsBrowse();
  render(<Harness onBrowse={onBrowse} onAskView={onAskView} first={{ filters: [{ column: "Sex", op: "=", value: "female" }], search: "", sort: { column: "Fare", desc: true } }} />);
  await ready();
  const asked = onBrowse.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Ask about this view" }));
  expect(onAskView).toHaveBeenCalledWith("@titanic Look at `select * from titanic where Sex = 'female' order by Fare desc`: ");
  expect(onBrowse.mock.calls.length).toBe(asked);
});

test("a page that fails says why in plain words, and a daemon without the method says to update", async () => {
  const slow = render(<Harness onBrowse={() => Promise.reject(new Error("The query took longer than 15 seconds and was cancelled."))} />);
  expect((await screen.findByRole("alert")).textContent).toBe("The query took longer than 15 seconds and was cancelled.");
  slow.unmount();
  render(<Harness onBrowse={() => Promise.reject(rpcError(-32601, "method not found"))} />);
  expect((await screen.findByRole("alert")).textContent).toContain("needs a newer golem");
});

test("a view with no rows says so", async () => {
  render(<Harness onBrowse={(_table, view) => Promise.resolve({ ...answer(view, 0), rows: [], total_rows: 0 })} />);
  expect(await screen.findByText("No rows match.")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("no rows match");
});

// -- the page around it: a click on a bar opens Rows filtered to that value -----------------------

function Page({ onBrowse, onAskView = () => {} }: { onBrowse: (table: string, view: DataBrowseView) => Promise<DataBrowseResult>; onAskView?: (text: string) => void }) {
  const [tab, setTab] = useState<DataTab>("tables");
  return (
    <SourcePage
      source={SAMPLE_TITANIC}
      described={{ source: SAMPLE_TITANIC, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [] }}
      notes={{ state: "missing" }}
      tab={tab}
      onTab={setTab}
      onAsk={() => {}}
      onRun={() => {}}
      onLoadProfile={() => Promise.resolve(SAMPLE_PASSENGER_PROFILE)}
      onBrowse={onBrowse}
      onAskView={onAskView}
      onSaveNotes={() => Promise.resolve("")}
      onDraftNotes={() => Promise.resolve("")}
      onPrivacy={() => Promise.resolve()}
      onWatch={() => Promise.resolve()}
      onRemove={() => Promise.resolve()}
    />
  );
}

test("a click on a bar of a category opens Rows filtered to that value, and the chip says so", async () => {
  const user = userEvent.setup();
  const onBrowse = rowsBrowse();
  render(<Page onBrowse={onBrowse} />);
  const sex = await screen.findByRole("button", { name: /^Sex female/ });
  expect(sex.getAttribute("title")).toMatch(/^Show these [\d ]+ rows$/);
  await user.click(sex);
  expect(screen.getByRole("tab", { name: "Rows" }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(onBrowse).toHaveBeenCalled());
  expect(onBrowse.mock.calls[0]?.[1]).toMatchObject({ offset: 0, filters: [{ column: "Sex", op: "=", value: "female" }] });
  expect(screen.getByRole("button", { name: "Remove filter Sex = female" })).toBeTruthy();
});

test("the view of the rows is kept when you visit another tab and come back", async () => {
  const user = userEvent.setup();
  render(<Page onBrowse={rowsBrowse()} />);
  await user.click(await screen.findByRole("button", { name: /^Pclass 1/ }));
  await screen.findByRole("button", { name: "Remove filter Pclass = 1" });
  await user.click(screen.getByRole("tab", { name: "Columns" }));
  await user.click(screen.getByRole("tab", { name: "Rows" }));
  expect(await screen.findByRole("button", { name: "Remove filter Pclass = 1" })).toBeTruthy();
});

test("the profile shows a chart for each shape, and the list and the cards say the same", async () => {
  const user = userEvent.setup();
  render(<Page onBrowse={rowsBrowse()} />);
  const list = await screen.findByRole("list", { name: "Columns of titanic" });
  expect(within(list).getAllByRole("listitem").length).toBe(12);
  expect(within(list).getByText("unique, 1 … 891 · looks like a key")).toBeTruthy();
  expect(within(list).getByRole("img", { name: /^Fare: / })).toBeTruthy();
  expect(within(list).getByText("0 · no")).toBeTruthy();
  expect(within(list).getAllByText(/% unique/).length).toBeGreaterThan(0);
  expect(within(list).getAllByText(/% empty$/, { selector: "code" }).length).toBeGreaterThan(0);
  await user.click(screen.getByRole("radio", { name: "Cards" }));
  const cards = screen.getByRole("list", { name: "Columns of titanic" });
  expect(within(cards).getAllByRole("listitem").length).toBe(12);
  expect(screen.getByRole("radio", { name: "Cards" }).getAttribute("aria-checked")).toBe("true");
});

test("the empty meter is amber with some gaps and red from half", async () => {
  render(<Page onBrowse={rowsBrowse()} />);
  const list = await screen.findByRole("list", { name: "Columns of titanic" });
  const meter = (name: string) => within(within(list).getByText(name, { selector: "code" }).closest("li") as HTMLElement).getByText(/empty$/).previousElementSibling?.firstElementChild;
  expect(meter("Age")?.className).toContain("bg-wait");
  expect(meter("Cabin")?.className).toContain("bg-deny");
  expect(meter("Name")?.className).not.toMatch(/bg-wait|bg-deny/);
});

// -- the live page: the draft, and a daemon that does not know the methods ------------------------

function mount(path: string, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  setup?.(fake);
  const source = { subscribe: () => () => {}, getSnapshot: () => CONNECTED };
  const created = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  created.start();
  render(
    <PageProvider page={created}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
  return fake;
}

test("on the live page, Rows asks the daemon by name, and Ask about this view fills a new chat's draft without sending it", async () => {
  const user = userEvent.setup();
  sidebarItemStore.set("data");
  const fake = mount("/data/titanic?tab=rows", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [SAMPLE_TITANIC] });
    raw.describeData.mockResolvedValue({ source: SAMPLE_TITANIC, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [] });
    raw.browseData.mockImplementation((params) => Promise.resolve(answer(params)));
  });
  await ready();
  expect(fake.raw.browseData.mock.calls[0]?.[0]).toMatchObject({ source: "titanic", table: "titanic", offset: 0, limit: 200 });
  await user.click(within(await screen.findByRole("columnheader", { name: /Fare/ })).getByRole("button"));
  await user.click(screen.getByRole("button", { name: "Ask about this view" }));
  await waitFor(() => expect(location.pathname).toBe("/"));
  const draft = (await screen.findAllByRole("textbox")).find((box) => (box as HTMLTextAreaElement).value.startsWith("@titanic")) as HTMLTextAreaElement;
  expect(draft.value).toBe("@titanic Look at `select * from titanic order by Fare`: ");
  expect(fake.raw.browseData.mock.calls.every(([params]) => !("sql" in params))).toBe(true);
});

test("on the live page, the Columns tab reads the profile of the table", async () => {
  sidebarItemStore.set("data");
  const fake = mount("/data/titanic", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [SAMPLE_TITANIC] });
    raw.describeData.mockResolvedValue({ source: SAMPLE_TITANIC, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [] });
    raw.profileData.mockResolvedValue(SAMPLE_PASSENGER_PROFILE);
  });
  expect(await screen.findByRole("list", { name: "Columns of titanic" })).toBeTruthy();
  expect(fake.raw.profileData).toHaveBeenCalledWith("titanic", "titanic");
});

test("a daemon without data.profile says to update, and the rest of the page still works", async () => {
  sidebarItemStore.set("data");
  mount("/data/titanic", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [SAMPLE_TITANIC] });
    raw.describeData.mockResolvedValue({ source: SAMPLE_TITANIC, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [SAMPLE_BANK_DESCRIBED.queries?.[0] ?? { name: "q", sql: "select 1" }] });
    raw.profileData.mockRejectedValue(rpcError(-32601, "method not found"));
  });
  expect((await screen.findByText(/Column charts need a newer golem/)).getAttribute("role")).toBe("alert");
  expect(screen.getByRole("tab", { name: "Queries" })).toBeTruthy();
});

// -- Export on the Rows tab -------------------------------------------------------------------------

function ExportHarness({ onKeep, onExport = () => Promise.resolve({ path: "/tmp/a.csv", rows: 3 }), first }: { onKeep: (table: string, view: DataBrowseKeepView) => Promise<DataBrowseKeepResult>; onExport?: () => Promise<{ path: string; rows: number }>; first: RowsView }) {
  const [view, setView] = useState(first);
  return <RowsBrowser source="titanic" table="titanic" columns={COLUMNS} tableRows={TOTAL} view={view} onView={setView} onBrowse={(_table, each) => Promise.resolve(answer(each, 312))} onAskView={() => {}} onKeep={onKeep} onExport={onExport} />;
}

test("Export asks for the kept view with the filters, the search and the sort, and no paging or SQL, then opens the dialog", async () => {
  const user = userEvent.setup();
  const onKeep = vi.fn(() => Promise.resolve({ result_id: "res_kept", rows: 312, truncated: false }));
  render(<ExportHarness onKeep={onKeep} first={{ filters: [{ column: "Sex", op: "=", value: "female" }], search: "Ann", sort: { column: "Fare", desc: true } }} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Export…" }));
  const dialog = await screen.findByRole("dialog");
  expect(onKeep).toHaveBeenCalledTimes(1);
  expect(onKeep.mock.calls[0]).toEqual(["titanic", { sort: { column: "Fare", desc: true }, filters: [{ column: "Sex", op: "=", value: "female" }], search: "Ann" }]);
  expect(JSON.stringify(onKeep.mock.calls)).not.toMatch(/select|offset|limit/i);
  expect(within(dialog).getByText(/312 rows from @titanic/)).toBeTruthy();
  expect(within(dialog).queryByText(/more rows than were kept/)).toBeNull();
});

test("a view cut by the row cap says how many rows go into the file, out of how many", async () => {
  const user = userEvent.setup();
  render(<ExportHarness onKeep={() => Promise.resolve({ result_id: "res_kept", rows: 100, truncated: true })} first={EMPTY_VIEW} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Export…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/100 rows of 312 rows will be exported: the query had more rows than were kept\./)).toBeTruthy();
});

test("a view that cannot be kept says why, and no dialog opens", async () => {
  const user = userEvent.setup();
  render(<ExportHarness onKeep={() => Promise.reject(new Error("There is no column called Nope in this table."))} first={EMPTY_VIEW} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Export…" }));
  expect((await screen.findByRole("alert")).textContent).toBe("There is no column called Nope in this table.");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("on the live page, Export keeps the view of the source's project and writes it", async () => {
  const user = userEvent.setup();
  sidebarItemStore.set("data");
  const mine = { ...SAMPLE_TITANIC, scope: "project", project: "/work/shop" } as const;
  const fake = mount("/data/titanic?tab=rows", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [mine] });
    raw.describeData.mockResolvedValue({ source: mine, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [] });
    raw.browseData.mockImplementation((params) => Promise.resolve(answer(params)));
    raw.browseDataKeep.mockResolvedValue({ result_id: "res_kept", rows: 2000, truncated: false });
    raw.exportDataResult.mockResolvedValue({ path: "/tmp/a.csv", rows: 2000 });
  });
  await ready();
  await user.click(screen.getByRole("button", { name: "Export…" }));
  const dialog = await screen.findByRole("dialog");
  expect(fake.raw.browseDataKeep).toHaveBeenCalledWith({ source: "titanic", table: "titanic", filters: [], project: "/work/shop" });
  await user.click(within(dialog).getByRole("button", { name: "Export" }));
  await waitFor(() => expect(fake.raw.exportDataResult).toHaveBeenCalled());
  expect(fake.raw.exportDataResult.mock.calls[0]).toEqual(["res_kept", expect.stringMatching(/\.csv$/), "csv", undefined, "/work/shop"]);
});

// -- notes of a project's source, with no chat open --------------------------------------------------

test("the Notes tab of a project's source loads with no session, through the source's project folder", async () => {
  sidebarItemStore.set("data");
  const mine = { ...SAMPLE_TITANIC, name: "mine", scope: "project", project: "/work/shop" } as const;
  const fake = mount("/data/mine?tab=notes", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [mine] });
    raw.describeData.mockResolvedValue({ source: mine, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [] });
    raw.getDataNotes.mockResolvedValue({ text: "Prices are in euros.", path: "/work/shop/.golem/data/mine/DATA.md" });
  });
  expect(await screen.findByText(/Prices are in euros\./)).toBeTruthy();
  expect(fake.raw.getDataNotes).toHaveBeenCalledWith("mine", "/work/shop");
  expect(fake.raw.describeData).toHaveBeenCalledWith("mine", undefined, "/work/shop");
});

test("a project that is not trusted is said in one sentence on the Notes tab", async () => {
  sidebarItemStore.set("data");
  const mine = { ...SAMPLE_TITANIC, name: "mine", scope: "project", project: "/work/shop" } as const;
  mount("/data/mine?tab=notes", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [mine] });
    raw.describeData.mockResolvedValue({ source: mine, tables: [SAMPLE_TITANIC_TABLE], sample: {}, queries: [] });
    raw.getDataNotes.mockRejectedValue(new Error("The project /work/shop is not trusted, so its sources are not opened. Trust the project first."));
  });
  expect(await screen.findByText("The project /work/shop is not trusted, so its sources are not opened. Trust the project first.")).toBeTruthy();
});
