import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { sidebarItemStore } from "../sidebar/sidebar-item.ts";
import { SAMPLE_BRIEFING, SAMPLE_CREATED, SAMPLE_DRAFT, SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PROJECT_STARTER, SAMPLE_STARTER_FOLDER, SAMPLE_STARTERS, SAMPLE_WORKFLOW_LIST } from "./sample.ts";
import { WorkflowNew, type WorkflowNewProps } from "./workflow-new.tsx";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };
const ASK = "Every Friday add up the new invoices and give me a table.";

beforeEach(() => {
  localStorage.clear();
  sidebarItemStore.set("sessions");
});
afterEach(() => {
  history.replaceState(null, "", "/");
  sidebarItemStore.set("sessions");
});

function props(over: Partial<WorkflowNewProps> = {}): WorkflowNewProps {
  return {
    starters: SAMPLE_STARTERS,
    workflows: [],
    folder: null,
    models: ["qwen3.5:9b", "deepseek/chat"],
    defaultModel: "qwen3.5:9b",
    onAddStarter: async () => {},
    onDraft: vi.fn(async () => SAMPLE_DRAFT),
    onCreate: vi.fn(async () => SAMPLE_CREATED),
    onSave: vi.fn(async () => ({ ...SAMPLE_CREATED, code_hash: "h3" })),
    onNavigate: () => {},
    ...over,
  };
}

const nameBox = () => screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;

test("the page offers the ways in: Describe it, an empty file, the starters, and From a chat as plain words that are not a button", async () => {
  const { container } = render(<WorkflowNew {...props()} />);
  expect(screen.getByRole("heading", { name: "New workflow" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Describe it" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Empty file" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Morning briefing" })).toBeTruthy();
  const chat = screen.getByRole("heading", { name: "From a chat" }).parentElement!;
  expect(chat.textContent).toContain("is coming");
  expect(within(chat).queryByRole("button")).toBeNull();
  expect(within(chat).queryByRole("link")).toBeNull();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the page says which model golem's default is, with the picker beside it", async () => {
  const user = userEvent.setup();
  render(<WorkflowNew {...props()} />);
  const picker = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
  expect(Array.from(picker.options).map((option) => option.textContent)).toEqual(["golem's default model (now qwen3.5:9b)", "qwen3.5:9b", "deepseek/chat"]);
  expect(screen.getByText(/golem's default model, qwen3.5:9b, writes it/)).toBeTruthy();
  await user.selectOptions(picker, "deepseek/chat");
  expect(screen.getByText(/deepseek\/chat writes it and is written in the file/)).toBeTruthy();
});

test("Write the steps with no name says so beside the name and writes nothing", async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn(async () => SAMPLE_DRAFT);
  render(<WorkflowNew {...props({ onDraft })} />);
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  expect(onDraft).not.toHaveBeenCalled();
  expect((await screen.findByText("Give the workflow a name.")).getAttribute("role")).toBe("alert");
  expect(document.activeElement).toBe(nameBox());
});

test("Write the steps with no sentences says so and asks nothing", async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn(async () => SAMPLE_DRAFT);
  render(<WorkflowNew {...props({ onDraft })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Say what the workflow should do");
  expect(onDraft).not.toHaveBeenCalled();
});

test("a described workflow opens with its steps and checks, unsaved, and nothing is created", async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn(async () => SAMPLE_DRAFT);
  const onCreate = vi.fn(async () => SAMPLE_CREATED);
  const { container } = render(<WorkflowNew {...props({ onDraft, onCreate })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  expect(await screen.findByRole("list", { name: "Outline" })).toBeTruthy();
  expect(onDraft).toHaveBeenCalledWith("Weekly invoices", ASK, null, null);
  expect(screen.getByRole("heading", { name: /Weekly invoices/ })).toBeTruthy();
  expect(screen.getByText(/Nothing has run and nothing is saved/)).toBeTruthy();
  expect(screen.getByText(/Written by qwen3.5:9b/)).toBeTruthy();
  expect(screen.getByText("✓ checks pass")).toBeTruthy();
  expect(screen.getByText(/changes? not saved/)).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem").length).toBeGreaterThan(1);
  expect(onCreate).not.toHaveBeenCalled();
  expect(screen.queryByText("Run it on a schedule?")).toBeNull();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("a picked model goes to the draft, and Back keeps what was typed", async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn(async () => SAMPLE_DRAFT);
  render(<WorkflowNew {...props({ onDraft })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "deepseek/chat");
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  await screen.findByRole("list", { name: "Outline" });
  expect(onDraft).toHaveBeenCalledWith("Weekly invoices", ASK, null, "deepseek/chat");
  await user.click(screen.getByRole("button", { name: "Back to the form" }));
  expect(nameBox().value).toBe("Weekly invoices");
  expect((screen.getByRole("textbox", { name: "What should it do?" }) as HTMLTextAreaElement).value).toBe(ASK);
});

test("a refused draft shows the daemon's reason and the button works again", async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn(async () => {
    throw new Error("no model is available to write a proposal");
  });
  render(<WorkflowNew {...props({ onDraft })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no model is available");
  expect((screen.getByRole("button", { name: "Write the steps" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Save creates the file from the draft, then asks Run it on a schedule? and Yes opens New routine filled in", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => SAMPLE_CREATED);
  const onNavigate = vi.fn();
  const { container } = render(<WorkflowNew {...props({ onCreate, onNavigate })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  await screen.findByRole("list", { name: "Outline" });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith("weekly_invoices", null, SAMPLE_DRAFT.code));
  const ask = await screen.findByRole("group", { name: "Run it on a schedule?" });
  expect(screen.getByText("Saved.")).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.click(within(ask).getByRole("button", { name: "Yes, add a routine" }));
  expect(onNavigate).toHaveBeenCalledWith(`/routines?new&workflow=${encodeURIComponent(SAMPLE_PR_DIGEST.id)}`);
});

test("after the first Save, a later Save writes the file it made and does not create another", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => SAMPLE_CREATED);
  const onSave = vi.fn(async () => ({ ...SAMPLE_CREATED, code_hash: "h3" }));
  render(<WorkflowNew {...props({ onCreate, onSave })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  await screen.findByRole("list", { name: "Outline" });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("group", { name: "Run it on a schedule?" });
  await user.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("group", { name: "Run it on a schedule?" })).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Steps and code" }));
  await user.click(screen.getByRole("textbox", { name: /Code of/ }));
  await user.keyboard("# more");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledWith(SAMPLE_PR_DIGEST.id, expect.stringContaining("# more"), SAMPLE_CREATED.code_hash);
  expect(onCreate).toHaveBeenCalledTimes(1);
});

test("a refused Save of the draft says why and keeps the draft", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => {
    throw new Error("not created: line 3: run has no fly");
  });
  render(<WorkflowNew {...props({ onCreate })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  await screen.findByRole("list", { name: "Outline" });
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByText(/Not saved\. not created: line 3/)).getAttribute("role")).toBe("alert");
  expect(screen.queryByRole("group", { name: "Run it on a schedule?" })).toBeNull();
  expect(screen.getByRole("list", { name: "Outline" })).toBeTruthy();
});

test("an empty file is created at once with the typed name, and opens in Code view with the schedule question", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => SAMPLE_CREATED);
  render(<WorkflowNew {...props({ onCreate })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Weekly invoices", null, null));
  expect((await screen.findByRole("button", { name: "Code" })).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("group", { name: "Run it on a schedule?" })).toBeTruthy();
  expect(screen.getByText(/Saved as/).textContent).toContain(SAMPLE_PR_DIGEST.path);
});

test("an empty file with no name says so beside the name and creates nothing", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => SAMPLE_CREATED);
  render(<WorkflowNew {...props({ onCreate })} />);
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("Give the workflow a name.")).toBeTruthy();
  expect(onCreate).not.toHaveBeenCalled();
});

test("a name that is taken is said beside the field with a free one, and one click uses it", async () => {
  const user = userEvent.setup();
  const taken = { ...SAMPLE_PR_DIGEST, name: "weekly_invoices", path: "/Users/you/.golem/workflows/weekly_invoices.py", project: undefined };
  render(<WorkflowNew {...props({ workflows: [taken] })} />);
  await user.type(nameBox(), "Weekly invoices");
  const note = await screen.findByText(/A workflow called weekly_invoices is there already\. Try weekly_invoices_2\./);
  expect(note.getAttribute("role")).toBe("alert");
  expect(nameBox().getAttribute("aria-invalid")).toBe("true");
  // It does not stop anything: the buttons stay on.
  expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Use weekly_invoices_2" }));
  expect(nameBox().value).toBe("weekly_invoices_2");
  expect(screen.queryByText(/is there already/)).toBeNull();
});

test("a taken name in a project does not count against your own folder", async () => {
  const user = userEvent.setup();
  const taken = { ...SAMPLE_PR_DIGEST, name: "weekly_invoices", path: `${SAMPLE_STARTER_FOLDER}/workflows/weekly_invoices.py`, project: SAMPLE_STARTER_FOLDER };
  render(<WorkflowNew {...props({ workflows: [taken], folder: SAMPLE_STARTER_FOLDER })} />);
  await user.type(nameBox(), "Weekly invoices");
  expect(screen.queryByText(/is there already/)).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Saved in" }), "project");
  expect(await screen.findByText(/is there already/)).toBeTruthy();
});

test("the daemon's refusal of a name is shown beside the name", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => {
    throw new Error("/Users/you/.golem/workflows/weekly_invoices.py exists already; it was not changed. Try weekly_invoices_2");
  });
  render(<WorkflowNew {...props({ onCreate })} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect((await screen.findByText(/weekly_invoices\.py exists already/)).getAttribute("role")).toBe("alert");
});

test("a name that cannot be a file name says why while you type", async () => {
  const user = userEvent.setup();
  render(<WorkflowNew {...props()} />);
  await user.type(nameBox(), "123 go");
  expect(await screen.findByText("The name must start with a letter.")).toBeTruthy();
});

test("Saved in offers your folder, and the project's folder when there is one, and the file goes where it says", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => SAMPLE_CREATED);
  const { rerender } = render(<WorkflowNew {...props({ onCreate })} />);
  const where = () => screen.getByRole("combobox", { name: "Saved in" }) as HTMLSelectElement;
  expect(Array.from(where().options).map((option) => option.textContent)).toEqual(["Yours (~/.golem/workflows)"]);
  rerender(<WorkflowNew {...props({ onCreate, folder: SAMPLE_STARTER_FOLDER })} />);
  expect(Array.from(where().options).map((option) => option.textContent)).toEqual(["Yours (~/.golem/workflows)", `This project (${SAMPLE_STARTER_FOLDER}/workflows)`]);
  await user.selectOptions(where(), "project");
  await user.type(nameBox(), "Weekly invoices");
  expect(screen.getByText(`File: ${SAMPLE_STARTER_FOLDER}/workflows/weekly_invoices.py`)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Weekly invoices", SAMPLE_STARTER_FOLDER, null));
});

test("the starter cards moved here: Add and Add and run keep working", async () => {
  const user = userEvent.setup();
  const onAddStarter = vi.fn(async () => {});
  render(<WorkflowNew {...props({ onAddStarter, starters: [SAMPLE_BRIEFING, SAMPLE_PROJECT_STARTER], folder: SAMPLE_STARTER_FOLDER })} />);
  const card = within(screen.getAllByRole("listitem").find((item) => item.textContent?.includes("Morning briefing"))!);
  await user.click(card.getByRole("button", { name: "Add" }));
  expect(onAddStarter).toHaveBeenLastCalledWith(SAMPLE_BRIEFING, false);
  await user.click(card.getByRole("button", { name: "Add and run every weekday at 07:30" }));
  expect(onAddStarter).toHaveBeenLastCalledWith(SAMPLE_BRIEFING, true);
});

test("a refused starter shows the daemon's reason on its card", async () => {
  const user = userEvent.setup();
  const onAddStarter = vi.fn(async () => {
    throw new Error("/h/.golem/workflows/morning_briefing.py exists already; it was not changed");
  });
  render(<WorkflowNew {...props({ onAddStarter })} />);
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect((await screen.findByRole("alert")).textContent).toContain("exists already");
});

function mount(path: string, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  setup?.(fake);
  const source = { subscribe: () => () => {}, getSnapshot: () => CONNECTED };
  const page = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  page.start();
  render(
    <PageProvider page={page}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
  return fake;
}

test("/workflows/new is a route: the page, the starters, and the model listing's default", async () => {
  const fake = mount("/workflows/new", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue(SAMPLE_WORKFLOW_LIST);
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
  });
  expect(await screen.findByRole("heading", { name: "New workflow" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Morning briefing" })).toBeTruthy();
  expect(await screen.findByText(/golem's default model, ollama\/qwen3:8b, writes it/)).toBeTruthy();
  expect(fake.raw.draftWorkflow).not.toHaveBeenCalled();
});

test("/workflows/new: describing sends the name, the sentences, the folder and the model to workflow.draft", async () => {
  const user = userEvent.setup();
  const fake = mount("/workflows/new", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [] });
    raw.draftWorkflow.mockResolvedValue(SAMPLE_DRAFT);
  });
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  expect(await screen.findByRole("list", { name: "Outline" })).toBeTruthy();
  expect(fake.raw.draftWorkflow).toHaveBeenCalledWith("Weekly invoices", ASK, undefined, undefined);
  expect(fake.raw.createWorkflow).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/workflows/new");
});

test("/workflows/new: Create makes an empty file through workflow.create and lists it", async () => {
  const user = userEvent.setup();
  const fake = mount("/workflows/new", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [] });
    raw.createWorkflow.mockResolvedValue(SAMPLE_CREATED);
  });
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Weekly invoices");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("group", { name: "Run it on a schedule?" })).toBeTruthy();
  expect(fake.raw.createWorkflow).toHaveBeenCalledWith("Weekly invoices", undefined, undefined);
  await waitFor(() => expect(fake.raw.listWorkflows.mock.calls.length).toBeGreaterThan(1));
});

test("/workflows/new: a starter is added and opened as before", async () => {
  const user = userEvent.setup();
  const id = "/h/.golem/workflows/morning_briefing.py::morning_briefing";
  const fake = mount("/workflows/new", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [] });
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
    raw.addWorkflowStarter.mockResolvedValue({ id, name: "morning_briefing", path: "/h/.golem/workflows/morning_briefing.py" });
  });
  act(() => fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", SAMPLE_STARTER_FOLDER)));
  await user.click(await screen.findByRole("button", { name: "Add" }));
  await waitFor(() => expect(location.pathname).toBe(`/workflows/${encodeURIComponent(id)}`));
  expect(fake.raw.addWorkflowStarter).toHaveBeenCalledWith("morning_briefing");
});

test("/workflows/new: Add and run asks for the routine too; a routine that failed is said on the page", async () => {
  const user = userEvent.setup();
  const id = "/h/.golem/workflows/morning_briefing.py::morning_briefing";
  const fake = mount("/workflows/new", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [] });
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
    raw.addWorkflowStarter.mockResolvedValue({ id, name: "morning_briefing", path: "/h/x.py", routine_problem: "the routine morning-briefing was not added: there is already a routine called morning-briefing" });
  });
  await user.click(await screen.findByRole("button", { name: "Add and run every weekday at 07:30" }));
  expect((await screen.findByRole("status")).textContent).toBe("The workflow was added. The routine morning-briefing was not added: there is already a routine called morning-briefing");
  expect(fake.raw.addWorkflowStarter).toHaveBeenCalledWith("morning_briefing", undefined, true);
  expect(location.pathname).toBe("/workflows/new");
});

test("+ New workflow in the rail's panel opens the page", async () => {
  const user = userEvent.setup();
  sidebarItemStore.set("workflows");
  mount("/", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue(SAMPLE_WORKFLOW_LIST);
  });
  const panel = await screen.findByRole("complementary", { name: "Workflows" });
  await user.click(within(panel).getByRole("button", { name: "+ New workflow" }));
  expect(location.pathname).toBe("/workflows/new");
  expect(await screen.findByRole("heading", { name: "New workflow" })).toBeTruthy();
});

test("the code of a draft is the text of the proposal", async () => {
  const user = userEvent.setup();
  render(<WorkflowNew {...props()} />);
  await user.type(nameBox(), "Weekly invoices");
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), ASK);
  await user.click(screen.getByRole("button", { name: "Write the steps" }));
  await screen.findByRole("list", { name: "Outline" });
  await user.click(screen.getByRole("button", { name: "Code" }));
  expect(screen.getByRole("textbox", { name: /Code of/ }).textContent).toContain(SAMPLE_PR_DIGEST_CODE.split("\n")[0]);
});
