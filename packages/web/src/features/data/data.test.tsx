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

test("Notes: Draft again fills the editor and says it is not saved, Save sends the text", async () => {
  const user = userEvent.setup();
  const onSaveNotes = vi.fn().mockResolvedValue("~/.golem/data/bank.md");
  render(<SourcePage {...page({ tab: "notes", onSaveNotes })} />);
  await user.click(screen.getByRole("button", { name: "Draft again" }));
  expect((screen.getByRole("textbox", { name: "Notes of bank" }) as HTMLTextAreaElement).value).toBe("# drafted\n");
  expect((await screen.findByRole("status")).textContent).toContain("not saved yet");
  expect(onSaveNotes).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSaveNotes).toHaveBeenCalledWith("# drafted\n");
  expect((await screen.findByRole("status")).textContent).toContain("Saved to ~/.golem/data/bank.md");
});

test("Notes and Queries say what to do when the notes methods are missing or there are no queries", () => {
  const { rerender } = render(<SourcePage {...page({ tab: "notes", notes: { state: "missing" } })} />);
  expect(screen.getByText("Notes come in a later version of golem.")).toBeTruthy();
  rerender(<SourcePage {...page({ tab: "queries", described: { ...SAMPLE_BANK_DESCRIBED, queries: [] } })} />);
  expect(screen.getByText("Save a query from a chat result and it shows here.")).toBeTruthy();
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
  const props = form({ onInspect: vi.fn().mockResolvedValue(SAMPLE_INSPECT_PG), onAdd: vi.fn().mockResolvedValue({ ...SAMPLE_BANK, name: "shop_dev", kind: "postgres" }) });
  await user.click(screen.getByRole("radio", { name: /Database/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Address" }), "postgres://golem_ro@localhost:5432/shop_dev");
  await user.type(screen.getByLabelText("Password"), "s3cret");
  expect(screen.getByText("goes to the macOS Keychain, never to a file or a model")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: /this project · shop-api/ }));
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  expect(await screen.findByText("Found 3 tables: users, orders, plans.")).toBeTruthy();
  expect(props.onInspect).toHaveBeenCalledWith("postgres://golem_ro@localhost:5432/shop_dev");
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
