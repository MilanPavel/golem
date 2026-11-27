import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { sidebarItemStore } from "../sidebar/sidebar-item.ts";
import { SAMPLE_PR_DIGEST_GET } from "../workflows/sample.ts";
import { WorkflowRunView, type WorkflowRunViewProps } from "./workflow-run-view.tsx";
import { SAMPLE_BRIEFING_PATH, SAMPLE_RUN_DONE, SAMPLE_RUN_FILE, SAMPLE_RUN_OUTPUTS, SAMPLE_RUN_TEXT, SAMPLE_RESULTS, WORKFLOW_RUN_NOW, type WorkflowRunSample } from "./workflow-sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };

beforeEach(() => {
  localStorage.clear();
  sidebarItemStore.set("sessions");
});
afterEach(() => {
  history.replaceState(null, "", "/");
  sidebarItemStore.set("sessions");
});

function view(sample: WorkflowRunSample, extra: Partial<WorkflowRunViewProps> = {}) {
  const props: WorkflowRunViewProps = {
    ...sample,
    now: WORKFLOW_RUN_NOW,
    chatPath: (child) => `/s/${child}`,
    onNavigate: vi.fn(),
    onCancel: vi.fn(async () => {}),
    onResume: vi.fn(async () => {}),
    onAnswer: vi.fn(async () => {}),
    onReadOutput: vi.fn(async () => ({ path: SAMPLE_BRIEFING_PATH, text: "# Briefing", size: 10, truncated: false })),
    ...extra,
  };
  return { props, ...render(<WorkflowRunView {...props} />) };
}

const actions = (title: string) => within(screen.getByRole("group", { name: `Actions for ${title}` }));

test("Copy puts the text of a text result on the clipboard and says Copied", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_TEXT);
  await user.click(actions("Morning briefing").getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toContain("# Morning briefing");
  expect(actions("Morning briefing").getByRole("button", { name: "Copied" })).toBeTruthy();
});

test("Copy takes the path of a file, the address of a link and the JSON of a table", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_FILE);
  await user.click(actions("Briefing file").getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toBe(SAMPLE_BRIEFING_PATH);
});

test("Copy of a table or a link, in the tabs of a run with several results", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_OUTPUTS);
  await user.click(screen.getByRole("tab", { name: "Failing checks" }));
  await user.click(actions("Failing checks").getByRole("button", { name: "Copy" }));
  expect(JSON.parse(await navigator.clipboard.readText())).toEqual(SAMPLE_RESULTS[2]![1]);
  await user.click(screen.getByRole("tab", { name: "Pull request" }));
  await user.click(actions("Pull request").getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toBe("https://github.com/golem/golem/pull/1921");
});

test("a clipboard that refuses is said, and nothing else breaks", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_TEXT);
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  await user.click(actions("Morning briefing").getByRole("button", { name: "Copy" }));
  expect(await screen.findByText(/clipboard is not available/)).toBeTruthy();
});

test("Show in Finder is offered for a file result only", () => {
  const { unmount } = view(SAMPLE_RUN_FILE, { onReveal: vi.fn(async () => {}) });
  expect(actions("Briefing file").getByRole("button", { name: "Show in Finder" })).toBeTruthy();
  unmount();
  view(SAMPLE_RUN_TEXT, { onReveal: vi.fn(async () => {}) });
  expect(screen.queryByRole("button", { name: /Finder/ })).toBeNull();
});

test("Show in Finder reveals the file with the run and the place of the result", async () => {
  const user = userEvent.setup();
  const onReveal = vi.fn(async () => {});
  view(SAMPLE_RUN_FILE, { onReveal });
  await user.click(actions("Briefing file").getByRole("button", { name: "Show in Finder" }));
  expect(onReveal).toHaveBeenCalledWith(SAMPLE_BRIEFING_PATH, 0);
});

test("a refusal of Show in Finder is said beside the button, which stays", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_FILE, { onReveal: vi.fn(async () => Promise.reject(new Error("That file is not a result of this run."))) });
  await user.click(actions("Briefing file").getByRole("button", { name: "Show in Finder" }));
  expect(await screen.findByText("That file is not a result of this run.")).toBeTruthy();
  expect(actions("Briefing file").getByRole("button", { name: "Show in Finder" })).toBeTruthy();
});

test("Ask about this hands over the text quoted, and a file as its path", async () => {
  const user = userEvent.setup();
  const onAskAbout = vi.fn();
  const { unmount } = view(SAMPLE_RUN_TEXT, { onAskAbout });
  await user.click(actions("Morning briefing").getByRole("button", { name: "Ask about this" }));
  const text = (onAskAbout.mock.calls[0] as unknown as [string])[0];
  expect(text).toContain('About this from the result "Morning briefing":');
  expect(text).toContain("> # Morning briefing");
  unmount();
  const second = vi.fn();
  view(SAMPLE_RUN_FILE, { onAskAbout: second });
  await user.click(actions("Briefing file").getByRole("button", { name: "Ask about this" }));
  expect((second.mock.calls[0] as unknown as [string])[0]).toContain(`\n\n${SAMPLE_BRIEFING_PATH}\n\n`);
});

test("without a way to start a chat, Ask about this is not offered, and Copy stays", () => {
  view(SAMPLE_RUN_TEXT);
  expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});

test("a run with no result has no actions", () => {
  view(SAMPLE_RUN_DONE, { onAskAbout: vi.fn() });
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
});

test("a step pane links to the step in the workflow", async () => {
  const user = userEvent.setup();
  const onSeeStep = vi.fn();
  view(SAMPLE_RUN_DONE, { onSeeStep });
  expect(screen.queryByRole("button", { name: "See this step in the workflow" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /summarise/ }));
  await user.click(screen.getByRole("button", { name: "See this step in the workflow" }));
  expect(onSeeStep).toHaveBeenCalledWith(expect.objectContaining({ key: "summarise" }));
});

test("the result with its actions passes axe", async () => {
  const { container } = view(SAMPLE_RUN_TEXT, { onAskAbout: vi.fn(), onSeeStep: vi.fn() });
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

function mount(path: string, setup: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  setup(fake);
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

test("/runs/:id: Ask about this opens a new chat with the result in the box, and the cursor there", async () => {
  const user = userEvent.setup();
  mount("/runs/wr_1", (fake) => {
    fake.raw.workflowStatus.mockResolvedValue({ ...SAMPLE_RUN_TEXT, run: { ...SAMPLE_RUN_TEXT.run, workflow_run_id: "wr_1" } });
  });
  await user.click(await screen.findByRole("button", { name: "Ask about this" }));
  const box = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(window.location.pathname).toBe("/"));
  expect((box as HTMLTextAreaElement).value).toContain("> # Morning briefing");
  expect(document.activeElement).toBe(box);
});

test("/runs/:id: See this step opens the workflow with that step selected, found by its title", async () => {
  const user = userEvent.setup();
  const fake = mount("/runs/wr_1", (one) => {
    // The run's step "summarise" is the outline step of the same kind and title.
    const status = { ...SAMPLE_RUN_DONE, run: { ...SAMPLE_RUN_DONE.run, workflow_run_id: "wr_1" } };
    status.steps = status.steps.map((step) => (step.key === "summarise" ? { ...step, title: "Summarise each pull request" } : step));
    one.raw.workflowStatus.mockResolvedValue(status);
    one.raw.getWorkflow.mockResolvedValue(SAMPLE_PR_DIGEST_GET);
  });
  await user.click(await screen.findByRole("button", { name: /Summarise each pull request/ }));
  await user.click(screen.getByRole("button", { name: "See this step in the workflow" }));
  await waitFor(() => expect(window.location.search).toBe("?step=s2"));
  expect(window.location.pathname).toContain("/workflows/");
  expect(fake.raw.getWorkflow).toHaveBeenCalledWith(SAMPLE_RUN_DONE.run.workflow_id);
});

test("/runs/:id: Show in Finder reveals the file with the run id and the index", async () => {
  const user = userEvent.setup();
  const fake = mount("/runs/wr_1", (one) => {
    one.raw.workflowStatus.mockResolvedValue({ ...SAMPLE_RUN_FILE, run: { ...SAMPLE_RUN_FILE.run, workflow_run_id: "wr_1" } });
    one.raw.readWorkflowOutput.mockResolvedValue({ path: SAMPLE_BRIEFING_PATH, text: "# Briefing", size: 10, truncated: false });
  });
  await user.click(await screen.findByRole("button", { name: "Show in Finder" }));
  await waitFor(() => expect(fake.raw.reveal).toHaveBeenCalledWith(SAMPLE_BRIEFING_PATH, { workflowRunId: "wr_1", outputIndex: 0 }));
});
