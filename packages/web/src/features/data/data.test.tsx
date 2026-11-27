import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError } from "../../store/test-support.ts";
import { sidebarItemStore } from "../sidebar/sidebar-item.ts";
import { AddDialog, type AddDialogProps } from "./add-dialog.tsx";
import { DataPanel } from "./data-panel.tsx";
import {
  SAMPLE_BANK,
  SAMPLE_BANK_DESCRIBED,
  SAMPLE_BUILTIN,
  SAMPLE_BUILTIN_DESCRIBED,
  SAMPLE_DATA_LIST,
  SAMPLE_FOLDER,
  SAMPLE_INSPECT_FILES,
  SAMPLE_INSPECT_PG,
  SAMPLE_PROD_DESCRIBED,
  SAMPLE_SHOP_PROD,
} from "./sample.ts";
import { SourcePage, type SourcePageProps } from "./source-page.tsx";

const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };

beforeEach(() => {
  localStorage.clear();
  sidebarItemStore.set("sessions");
});
afterEach(() => {
  history.replaceState(null, "", "/");
  sidebarItemStore.set("sessions");
});

test("the panel groups this project and yours, with a chip and a detail for each source", async () => {
  const onNavigate = vi.fn();
  render(<DataPanel answer={{ status: "ready", data: SAMPLE_DATA_LIST }} folder={SAMPLE_FOLDER} selected="bank" onNavigate={onNavigate} onAdd={() => {}} />);
  expect(screen.getAllByText(/^(This project|Yours)/).map((node) => node.textContent)).toEqual(["This project · shop-api", "Yours"]);
  const prod = screen.getByRole("link", { name: /shop_prod/ });
  expect(prod.textContent).toContain("schema only");
  expect(screen.getByRole("link", { name: /shop_dev/ }).textContent).toContain("3 tables · 27 117 rows");
  expect(screen.getByRole("link", { name: /bank/ }).textContent).toContain("rows local");
  expect(screen.getByRole("link", { name: /bank/ }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: /logs/ }).textContent).toContain("untrusted — trust this folder to use it");
  expect(screen.getByRole("link", { name: /receipts/ }).textContent).toContain("reading…");
  expect(screen.getByRole("link", { name: /archive/ }).textContent).toContain("No such file");
  await userEvent.setup().click(prod);
  expect(onNavigate).toHaveBeenCalledWith("/data/shop_prod");
});

test("the panel says so when there are none, when it is loading, and when the daemon does not know Data", async () => {
  const onAdd = vi.fn();
  const { rerender } = render(<DataPanel answer={{ status: "ready", data: { sources: [] } }} folder={null} selected={null} onNavigate={() => {}} onAdd={onAdd} />);
  expect(screen.getByText(/No sources yet/)).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /Add/ }));
  expect(onAdd).toHaveBeenCalled();
  rerender(<DataPanel answer={null} folder={null} selected={null} onNavigate={() => {}} onAdd={onAdd} />);
  expect(screen.getByText("Loading sources.")).toBeTruthy();
  rerender(<DataPanel answer={{ status: "missing" }} folder={null} selected={null} onNavigate={() => {}} onAdd={onAdd} />);
  expect(screen.getByText(/not available yet/)).toBeTruthy();
});

function page(over: Partial<SourcePageProps> = {}): SourcePageProps {
  return {
    source: SAMPLE_BANK,
    described: SAMPLE_BANK_DESCRIBED,
    notes: { state: "ready", text: "# bank\n", path: "~/.golem/data/bank.md" },
    tab: "tables",
    onTab: () => {},
    onAsk: () => {},
    onRun: () => {},
    onLoadSample: () => Promise.resolve([]),
    onSaveNotes: () => Promise.resolve("~/.golem/data/bank.md"),
    onDraftNotes: () => Promise.resolve("# drafted\n"),
    onPrivacy: () => Promise.resolve(),
    onWatch: () => Promise.resolve(),
    onRemove: () => Promise.resolve(),
    ...over,
  };
}

test("a rows-local source shows its columns, and its sample under the local caption", () => {
  render(<SourcePage {...page()} />);
  expect(screen.getByText("Columns · every model may see these")).toBeTruthy();
  expect(screen.getByText("Sample rows · you and local models")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Sample rows of transactions" }).textContent).toContain("SPOTIFY P1A2");
  expect(screen.getByRole("table", { name: "Columns of transactions" }).textContent).toContain("DECIMAL(10,2)");
});

const LONG_NAME = "Cumings, Mrs. John Bradley (Florence Briggs Thayer)";

function withFiles(files: string[], over: { min: string; max: string }): SourcePageProps {
  const described = {
    ...SAMPLE_BANK_DESCRIBED,
    tables: [
      {
        name: "passengers",
        rows: files.length,
        columns: [
          { name: "id", type: "BIGINT", distinct: 891, distinct_estimate: false },
          { name: "name", type: "VARCHAR", distinct: 1045, distinct_estimate: true },
          { name: "file", type: "VARCHAR", min: over.min, max: over.max, distinct: 1 },
        ],
      },
    ],
    sample: { passengers: files.map((file, at) => [at + 1, LONG_NAME, file]) },
  };
  return page({ described });
}

test("the header and the tab bar stick together, and the sample table's header sticks in its own box", () => {
  const { container } = render(<SourcePage {...page()} />);
  const sticky = container.querySelector('[data-sticky="source-header"]');
  expect(sticky?.className).toContain("sticky");
  expect(sticky?.className).toContain("-top-5");
  expect(sticky?.className).toContain("bg-bg");
  expect(within(sticky as HTMLElement).getByRole("tablist")).toBeTruthy();
  expect(within(sticky as HTMLElement).getByRole("heading", { level: 1 })).toBeTruthy();
  const sample = screen.getByRole("table", { name: "Sample rows of transactions" });
  expect(sample.querySelector("th")?.className).toContain("sticky");
  expect(sample.parentElement?.className).toContain("overflow-auto");
});

test("a table from one file hides its file column in the stats and the sample", () => {
  render(<SourcePage {...withFiles(["/data/titanic.csv", "/data/titanic.csv"], { min: "/data/titanic.csv", max: "/data/titanic.csv" })} />);
  expect(screen.getByRole("table", { name: "Sample rows of passengers" }).textContent).not.toContain("titanic.csv");
  expect(within(screen.getByRole("table", { name: "Sample rows of passengers" })).queryByRole("columnheader", { name: "file" })).toBeNull();
  expect(within(screen.getByRole("table", { name: "Columns of passengers" })).queryByText("file")).toBeNull();
});

test("a table from several files shows the file name, with the whole path on hover", () => {
  render(<SourcePage {...withFiles(["/data/a/jan.csv", "/data/a/feb.csv"], { min: "/data/a/feb.csv", max: "/data/a/jan.csv" })} />);
  const sample = screen.getByRole("table", { name: "Sample rows of passengers" });
  expect(within(sample).getByRole("columnheader", { name: "file" })).toBeTruthy();
  const cell = within(sample).getByText("jan.csv");
  expect(cell.getAttribute("title")).toBe("/data/a/jan.csv");
  expect(sample.textContent).not.toContain("/data/a/");
});

test("a long text cell is one line cut at a width, with the whole value in its title; numbers stay right-aligned", () => {
  render(<SourcePage {...withFiles(["/data/a.csv"], { min: "/data/a.csv", max: "/data/a.csv" })} />);
  const sample = screen.getByRole("table", { name: "Sample rows of passengers" });
  const long = within(sample).getByText(LONG_NAME);
  expect(long.getAttribute("title")).toBe(LONG_NAME);
  expect(long.getAttribute("tabindex")).toBe("0");
  expect(long.className).toContain("truncate");
  expect(long.className).toContain("max-w-64");
  expect(within(sample).getByText("1").closest("td")?.className).toContain("text-right");
});

test("an estimated distinct count starts with a tilde and an exact one does not", () => {
  render(<SourcePage {...withFiles(["/data/a.csv"], { min: "/data/a.csv", max: "/data/a.csv" })} />);
  const columns = screen.getByRole("table", { name: "Columns of passengers" });
  expect(columns.textContent).toContain("891 distinct");
  expect(columns.textContent).not.toContain("~891");
  expect(columns.textContent).toMatch(/~1\s045 distinct/);
});

test("a schema-only source does not fetch its sample until asked", async () => {
  const onLoadSample = vi.fn().mockResolvedValue([[1, "a@example.test"]]);
  render(<SourcePage {...page({ source: SAMPLE_SHOP_PROD, described: SAMPLE_PROD_DESCRIBED, onLoadSample })} />);
  expect(screen.getByText("Sample rows · only you, on request")).toBeTruthy();
  expect(onLoadSample).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Show sample rows" }));
  expect(onLoadSample).toHaveBeenCalledWith("users");
  expect(await screen.findByRole("table", { name: "Sample rows of users" })).toBeTruthy();
});

test("the built-in source has no Remove and no privacy choice, and says why", () => {
  render(<SourcePage {...page({ source: SAMPLE_BUILTIN, described: SAMPLE_BUILTIN_DESCRIBED, tab: "settings" })} />);
  expect(screen.queryByRole("button", { name: "Remove source" })).toBeNull();
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(screen.getByText("golem's own usage, runs and chats list. No message text.")).toBeTruthy();
});

test("Settings changes the privacy, watches the folder, and Remove says what it does", async () => {
  const user = userEvent.setup();
  const onPrivacy = vi.fn().mockResolvedValue(undefined);
  const onWatch = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(undefined);
  render(<SourcePage {...page({ tab: "settings", onPrivacy, onWatch, onRemove })} />);
  expect(screen.getByRole("radio", { name: /rows local/ }).getAttribute("aria-checked")).toBe("true");
  await user.click(screen.getByRole("radio", { name: /schema only/ }));
  expect(onPrivacy).toHaveBeenCalledWith("schema");
  await user.click(screen.getByRole("checkbox", { name: "Watch the folder" }));
  expect(onWatch).toHaveBeenCalledWith(false);
  expect(screen.getByText("golem forgets it. The files and the database stay as they are.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Remove source" }));
  expect(onRemove).toHaveBeenCalled();
});

test("Notes: Edit opens the editor, Save sends the text and shows the notes again, Cancel changes nothing", async () => {
  const user = userEvent.setup();
  const onSaveNotes = vi.fn().mockResolvedValue("~/.golem/data/bank/DATA.md");
  render(<SourcePage {...page({ tab: "notes", onSaveNotes })} />);
  expect(screen.getByLabelText("Notes of bank").textContent).toBe("# bank\n");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSaveNotes).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getByRole("textbox", { name: "Notes of bank" });
  await user.click(box);
  await user.keyboard("amount < 0 is money out");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSaveNotes).toHaveBeenCalledWith(expect.stringContaining("amount < 0 is money out"));
  expect((await screen.findByRole("status")).textContent).toContain("Saved to ~/.golem/data/bank/DATA.md");
  expect(screen.queryByRole("textbox", { name: "Notes of bank" })).toBeNull();
});

test("Notes: a draft is a proposal that is not saved until Accept, and Discard drops it", async () => {
  const user = userEvent.setup();
  const onSaveNotes = vi.fn().mockResolvedValue("~/.golem/data/bank/DATA.md");
  render(<SourcePage {...page({ tab: "notes", onSaveNotes })} />);
  await user.click(screen.getByRole("button", { name: "Draft with golem" }));
  const proposal = await screen.findByRole("region", { name: "Drafted notes" });
  expect(proposal.textContent).toContain("# drafted");
  expect(proposal.textContent).toContain("not saved until you accept");
  expect(onSaveNotes).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("region", { name: "Drafted notes" })).toBeNull();
  expect(onSaveNotes).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Notes of bank").textContent).toBe("# bank\n");
  await user.click(screen.getByRole("button", { name: "Draft with golem" }));
  await screen.findByRole("region", { name: "Drafted notes" });
  await user.click(screen.getByRole("button", { name: "Accept" }));
  expect(onSaveNotes).toHaveBeenCalledWith("# drafted\n");
  expect((await screen.findByRole("status")).textContent).toContain("Saved to");
  expect(screen.getByLabelText("Notes of bank").textContent).toBe("# drafted\n");
});

test("Notes: Edit first moves the proposal into the editor, and a source without notes offers Draft notes", async () => {
  const user = userEvent.setup();
  render(<SourcePage {...page({ tab: "notes", notes: { state: "ready", text: null, path: null } })} />);
  expect(screen.getByText(/No notes yet/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Draft notes" }));
  await screen.findByRole("region", { name: "Drafted notes" });
  await user.click(screen.getByRole("button", { name: "Edit first" }));
  expect((screen.getByRole("textbox", { name: "Notes of bank" }) as HTMLTextAreaElement).value).toBe("# drafted\n");
});

test("Notes: a draft that fails says why and keeps the notes", async () => {
  const user = userEvent.setup();
  const onDraftNotes = vi.fn().mockRejectedValue(new Error("a budget cap is spent"));
  render(<SourcePage {...page({ tab: "notes", onDraftNotes })} />);
  await user.click(screen.getByRole("button", { name: "Draft with golem" }));
  expect((await screen.findByRole("alert")).textContent).toContain("a budget cap is spent");
  expect(screen.getByLabelText("Notes of bank").textContent).toBe("# bank\n");
});

test("Notes and Queries say what to do when the notes methods are missing or there are no queries", () => {
  const { rerender } = render(<SourcePage {...page({ tab: "notes", notes: { state: "missing" } })} />);
  expect(screen.getByText("Notes come in a later version of golem.")).toBeTruthy();
  rerender(<SourcePage {...page({ tab: "queries", described: { ...SAMPLE_BANK_DESCRIBED, queries: [] } })} />);
  expect(screen.getByText("A saved query is a named question you ask often, like spending by month.")).toBeTruthy();
  expect(screen.getByText("Run it again in one click, use it in a routine, or let golem reuse it.")).toBeTruthy();
});

test("Queries: Run hands the query to the chat", async () => {
  const onRun = vi.fn();
  render(<SourcePage {...page({ tab: "queries", onRun })} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Run spending by month" }));
  expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ name: "spending by month" }));
});

function form(over: Partial<AddDialogProps> = {}) {
  const props: AddDialogProps = {
    open: true,
    folder: SAMPLE_FOLDER,
    onInspect: vi.fn().mockResolvedValue(SAMPLE_INSPECT_FILES),
    onInspectDatabase: vi.fn().mockResolvedValue(SAMPLE_INSPECT_PG),
    onAdd: vi.fn().mockResolvedValue(SAMPLE_BANK),
    onAdded: vi.fn(),
    onCancel: vi.fn(),
    onOpenMcp: vi.fn(),
    ...over,
  };
  render(<AddDialog {...props} />);
  return props;
}

test("the dialog walks kind, where and privacy, and adds the files with the suggested name and level", async () => {
  const user = userEvent.setup();
  const props = form();
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Path" }), "~/Documents/bank/*.csv");
  await user.click(screen.getByRole("button", { name: "Check" }));
  expect(await screen.findByText("36 files match, one table: transactions.")).toBeTruthy();
  expect(screen.getByText("amount is money: negative looks like money out")).toBeTruthy();
  expect(props.onInspect).toHaveBeenCalledWith("~/Documents/bank/*.csv");
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("bank");
  expect(screen.getByRole("radio", { name: /rows local/ }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("suggested")).toBeTruthy();
  expect(screen.getByText(/Suggested because: The files are in your home folder/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Add source" }));
  expect(props.onAdd).toHaveBeenCalledWith({ name: "bank", location: "~/Documents/bank/*.csv", kind: "files", privacy: "local", scope: "user", watch: true });
  await waitFor(() => expect(props.onAdded).toHaveBeenCalledWith(SAMPLE_BANK));
});

test("a database goes with its scope and password, and the password is gone from the form after Add", async () => {
  const user = userEvent.setup();
  const props = form({
    onInspectDatabase: vi.fn().mockResolvedValue(SAMPLE_INSPECT_PG),
    onAdd: vi.fn().mockResolvedValue({ ...SAMPLE_BANK, name: "shop_dev", kind: "postgres" }),
  });
  await user.click(screen.getByRole("radio", { name: /Database/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Host" }), "localhost");
  await user.type(screen.getByRole("textbox", { name: "Port" }), "5432");
  await user.type(screen.getByRole("textbox", { name: "Database" }), "shop_dev");
  await user.type(screen.getByRole("textbox", { name: "User" }), "golem_ro");
  await user.type(screen.getByLabelText("Password"), "s3cret");
  expect(screen.getByText("goes to the macOS Keychain, never to a file or a model")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: /this project · shop-api/ }));
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  expect(await screen.findByText("connected · PostgreSQL 17.2 · 3 tables · 1 schema")).toBeTruthy();
  expect(props.onInspectDatabase).toHaveBeenCalledWith({ kind: "postgres", host: "localhost", database: "shop_dev", port: 5432, user: "golem_ro", password: "s3cret" });
  expect(props.onInspect).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("radio", { name: /rows open/ }).getAttribute("aria-checked")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Add source" }));
  expect(props.onAdd).toHaveBeenCalledWith({
    name: "shop_dev",
    location: "postgres://golem_ro@localhost:5432/shop_dev",
    kind: "postgres",
    privacy: "open",
    scope: "project",
    watch: false,
    password: "s3cret",
  });
  await waitFor(() => expect(props.onAdded).toHaveBeenCalled());
  expect(screen.queryByDisplayValue("s3cret")).toBeNull();
  expect(document.body.textContent).not.toContain("s3cret");
});

test("a login that can write is warned about, and the warning does not stop Next", async () => {
  const user = userEvent.setup();
  const warning = "This login can change data. golem only reads, but a read-only login is safer.";
  form({ onInspectDatabase: vi.fn().mockResolvedValue({ ...SAMPLE_INSPECT_PG, warning }) });
  await user.click(screen.getByRole("radio", { name: /Database/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Host" }), "db.internal");
  await user.type(screen.getByRole("textbox", { name: "Database" }), "shop");
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  expect(await screen.findByText(warning)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
});

test("without a test the dialog says what Next does, and a failed test still lets the person go on", async () => {
  const user = userEvent.setup();
  const props = form({ onInspectDatabase: vi.fn().mockRejectedValue(new Error("Cannot connect to the postgres database at db.internal: refused")) });
  await user.click(screen.getByRole("radio", { name: /Database/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/You have not tested the connection\. Next tests it for you/)).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Host" }), "db.internal");
  await user.type(screen.getByRole("textbox", { name: "Database" }), "shop");
  const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
  expect(next.disabled).toBe(false);
  await user.click(next);
  expect(props.onInspectDatabase).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("shop");
  await user.click(screen.getByRole("button", { name: "Add source" }));
  expect(props.onAdd).toHaveBeenCalledWith(expect.objectContaining({ location: "postgres://db.internal/shop", kind: "postgres" }));
});

test("a database source's settings say where the password is, and Change password stores a new one", async () => {
  const user = userEvent.setup();
  const onChangePassword = vi.fn().mockResolvedValue(undefined);
  render(<SourcePage {...page({ source: SAMPLE_SHOP_PROD, described: SAMPLE_PROD_DESCRIBED, tab: "settings", onChangePassword })} />);
  expect(screen.getByText("password in the macOS Keychain · golem/data/shop_prod")).toBeTruthy();
  expect(screen.getByText("read-only transaction · 7 s per query · 10 000 rows per result")).toBeTruthy();
  expect(screen.getByText(/This login can change data/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Change password" }));
  await user.type(screen.getByLabelText("New password"), "n3w");
  await user.click(screen.getByRole("button", { name: "Store password" }));
  expect(onChangePassword).toHaveBeenCalledWith("n3w");
  await waitFor(() => expect(screen.queryByLabelText("New password")).toBeNull());
  expect(document.body.textContent).not.toContain("n3w");
});

test("a failed check shows under the field, and Next still works; Add source shows the real error", async () => {
  const user = userEvent.setup();
  const props = form({ onInspect: vi.fn().mockRejectedValue(new Error("No files match ~/x/*.csv.")), onAdd: vi.fn().mockRejectedValue(new Error("the folder is gone")) });
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Path" }), "~/x/*.csv");
  await user.click(screen.getByRole("button", { name: "Check" }));
  expect((await screen.findByRole("alert")).textContent).toBe("No files match ~/x/*.csv.");
  expect(screen.getByRole("textbox", { name: "Path" }).getAttribute("aria-invalid")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("x");
  await user.click(screen.getByRole("button", { name: "Add source" }));
  expect((await screen.findByRole("alert")).textContent).toBe("the folder is gone");
  expect(props.onAdded).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Add source" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Through MCP does not add a source: it opens Settings", async () => {
  const user = userEvent.setup();
  const props = form();
  await user.click(screen.getByRole("radio", { name: /Through MCP/ }));
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Open MCP servers" }));
  expect(props.onOpenMcp).toHaveBeenCalled();
  expect(props.onAdd).not.toHaveBeenCalled();
});

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

test("the rail has a Data item between Inbox and Routines, and its panel lists the sources", async () => {
  const user = userEvent.setup();
  mount("/", ({ raw }) => {
    raw.listData.mockResolvedValue(SAMPLE_DATA_LIST);
  });
  const rail = screen.getByRole("navigation", { name: "Sidebar rail" });
  const names = within(rail).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  expect(names.indexOf("Data")).toBe(names.indexOf("Inbox") + 1);
  expect(names.indexOf("Routines")).toBe(names.indexOf("Data") + 1);
  await user.click(within(rail).getByRole("button", { name: "Data" }));
  expect(await screen.findByRole("link", { name: /bank/ })).toBeTruthy();
  // A project source of another folder is not listed.
  expect(screen.queryByRole("link", { name: /shop_prod/ })).toBeNull();
});

test("/data/:name loads the source and its tables, and a data.changed push reads the list again", async () => {
  sidebarItemStore.set("data");
  const fake = mount("/data/bank", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [SAMPLE_BANK] });
    raw.describeData.mockResolvedValue(SAMPLE_BANK_DESCRIBED);
  });
  expect(await screen.findByRole("heading", { name: /bank/ })).toBeTruthy();
  expect(await screen.findByRole("table", { name: "Columns of transactions" })).toBeTruthy();
  const calls = fake.raw.listData.mock.calls.length;
  fake.emitData({ reason: "added", source: null });
  await waitFor(() => expect(fake.raw.listData.mock.calls.length).toBeGreaterThan(calls));
});

test("a daemon without data.list gets a plain not-available state, not an error", async () => {
  sidebarItemStore.set("data");
  mount("/data/bank", ({ raw }) => {
    raw.listData.mockRejectedValue(rpcError(-32601, "method not found"));
  });
  expect(await screen.findAllByText(/not available yet/)).not.toHaveLength(0);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("Ask in a chat opens a new chat with @name in the composer", async () => {
  const user = userEvent.setup();
  mount("/data/bank", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [SAMPLE_BANK] });
    raw.describeData.mockResolvedValue(SAMPLE_BANK_DESCRIBED);
  });
  await user.click(await screen.findByRole("button", { name: "Ask in a chat" }));
  await waitFor(() => expect(location.pathname).toBe("/"));
  expect(((await screen.findAllByRole("textbox")).find((box) => (box as HTMLTextAreaElement).value.startsWith("@bank")) as HTMLTextAreaElement).value).toBe("@bank ");
});

test("adding a source through the panel calls data.add with the scope and opens the new page", async () => {
  const user = userEvent.setup();
  sidebarItemStore.set("data");
  const fake = mount("/", ({ raw }) => {
    raw.listData.mockResolvedValue({ sources: [] });
    raw.inspectData.mockResolvedValue(SAMPLE_INSPECT_FILES);
    raw.describeData.mockResolvedValue(SAMPLE_BANK_DESCRIBED);
  });
  await user.click(await screen.findByRole("button", { name: /Add/ }));
  const dialog = await screen.findByRole("dialog", { name: "Add a source" });
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Path" }), "~/Documents/bank/*.csv");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await user.click(within(dialog).getByRole("button", { name: "Add source" }));
  await waitFor(() => expect(location.pathname).toBe("/data/bank"));
  expect(fake.raw.addData).toHaveBeenCalledWith({ name: "bank", location: "~/Documents/bank/*.csv", kind: "files", privacy: "local", scope: "user", watch: true });
});
