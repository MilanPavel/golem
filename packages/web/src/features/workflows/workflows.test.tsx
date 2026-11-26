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
import { SAMPLE_BROKEN, SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_GET, SAMPLE_PR_DIGEST_STEPS, SAMPLE_UNTRUSTED, SAMPLE_WORKFLOW_LIST, SAMPLE_WORKFLOW_LIST_TWO_PROJECTS, SAMPLE_WORKFLOW_RUNS, WORKFLOWS_NOW } from "./sample.ts";
import { stepLines, workflowGroups, workflowRuns } from "./text.ts";
import { WorkflowDetail } from "./workflow-detail.tsx";
import { WorkflowsPanel } from "./workflows-panel.tsx";

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

test("the panel lists This project first, then Yours, and a broken workflow shows its error", async () => {
  const onNavigate = vi.fn();
  const { container } = render(<WorkflowsPanel list={SAMPLE_WORKFLOW_LIST} selected={SAMPLE_PR_DIGEST.id} onNavigate={onNavigate} />);
  const headings = screen.getAllByText(/^(This project|Yours)/).map((node) => node.textContent);
  expect(headings).toEqual(["This project · site", "Yours"]);
  expect(screen.getByRole("link", { name: /pr_digest/ }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: /pr_digest/ }).textContent).toContain("One line for each open pull request");
  expect(screen.getByRole("link", { name: /nightly/ }).textContent).toContain("Run the checks on the main branch");
  // No description: the trigger says what starts it.
  expect(screen.getByRole("link", { name: /hello/ }).textContent).toContain("By hand");
  expect(screen.getByRole("link", { name: /broken/ }).textContent).toContain("ImportError: cannot import name 'Runn'");
  expect(screen.getByRole("link", { name: /pr_digest/ }).getAttribute("href")).toBe(`/workflows/${encodeURIComponent(SAMPLE_PR_DIGEST.id)}`);
  await userEvent.setup().click(screen.getByRole("link", { name: /hello/ }));
  expect(onNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/workflows\//));
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("with two projects each group is named by its folder, and an untrusted file says so", () => {
  render(<WorkflowsPanel list={SAMPLE_WORKFLOW_LIST_TWO_PROJECTS} selected={null} onNavigate={() => {}} />);
  expect(screen.getByText("site")).toBeTruthy();
  expect(screen.getByText("other")).toBeTruthy();
  expect(screen.getByRole("link", { name: /deploy/ }).textContent).toContain("not trusted");
});

test("the panel filters, and says so when there are none or the answer has not come", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<WorkflowsPanel list={SAMPLE_WORKFLOW_LIST} selected={null} onNavigate={() => {}} />);
  await user.type(screen.getByRole("textbox", { name: "Filter workflows" }), "zzz");
  expect(screen.getByText("No workflows match.")).toBeTruthy();
  rerender(<WorkflowsPanel list={{ workflows: [] }} selected={null} onNavigate={() => {}} />);
  expect(screen.getByText(/No workflows yet/)).toBeTruthy();
  rerender(<WorkflowsPanel list={null} selected={null} onNavigate={() => {}} />);
  expect(screen.getByText("Loading workflows.")).toBeTruthy();
  rerender(<WorkflowsPanel list={null} error="down" selected={null} onNavigate={() => {}} />);
  expect(screen.getByText("Could not load workflows.")).toBeTruthy();
});

test("groups and run filtering are pure", () => {
  expect(workflowGroups(SAMPLE_WORKFLOW_LIST.workflows).map((group) => group.label)).toEqual(["This project", "Yours"]);
  expect(stepLines(SAMPLE_PR_DIGEST_STEPS)).toEqual(new Set([12, 15, 20, 23]));
  const other = { ...SAMPLE_WORKFLOW_RUNS[0]!, session_id: "x", origin: "workflow:other" };
  const routine = { ...SAMPLE_WORKFLOW_RUNS[0]!, session_id: "y", kind: "routine" as const, origin: "workflow:pr_digest" };
  expect(workflowRuns([...SAMPLE_WORKFLOW_RUNS, other, routine], "pr_digest")).toHaveLength(SAMPLE_WORKFLOW_RUNS.length);
});

function detail(extra: Partial<Parameters<typeof WorkflowDetail>[0]> = {}) {
  return (
    <WorkflowDetail workflow={SAMPLE_PR_DIGEST} steps={SAMPLE_PR_DIGEST_STEPS} code={SAMPLE_PR_DIGEST_CODE} runs={SAMPLE_WORKFLOW_RUNS} now={WORKFLOWS_NOW} onNavigate={() => {}} {...extra} />
  );
}

test("the Overview shows the description, the inputs, the steps with their lines, and what starts it", async () => {
  const { container } = render(detail());
  expect(screen.getByRole("heading", { name: /pr_digest/ })).toBeTruthy();
  expect(screen.getByText("One line for each open pull request, checked by you, then a notice.", { selector: "p" })).toBeTruthy();
  const inputs = within(screen.getByRole("table", { name: "Inputs" }));
  expect(inputs.getAllByRole("row")).toHaveLength(4);
  expect(inputs.getByText('"1d"')).toBeTruthy();
  expect(inputs.getAllByText("required")).toHaveLength(2);
  const steps = within(screen.getByRole("list", { name: "Steps" }));
  expect(steps.getAllByRole("listitem")).toHaveLength(4);
  expect(steps.getByText("line 15")).toBeTruthy();
  expect(steps.getByText("llm · for each pulls")).toBeTruthy();
  expect(screen.getByText("By hand")).toBeTruthy();
  // Run… is there and disabled until the dialog exists.
  expect((screen.getByRole("button", { name: "Run…" }) as HTMLButtonElement).disabled).toBe(true);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the Code tab shows the file read only with a dot on each step's line, and Show in Finder reveals it", async () => {
  const user = userEvent.setup();
  const onReveal = vi.fn(() => Promise.resolve());
  const { container } = render(detail({ onReveal }));
  await user.click(screen.getByRole("tab", { name: "Code" }));
  const editor = screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement;
  expect(editor.readOnly).toBe(true);
  expect(editor.value).toBe(SAMPLE_PR_DIGEST_CODE);
  // The gutter marks the four lines: "●12", "●15", "●20", "●23".
  const gutter = container.querySelector(".code-editor-layer")?.textContent ?? "";
  expect(gutter.match(/●/g)).toHaveLength(4);
  expect(gutter).toContain("●12");
  expect(screen.getByText(SAMPLE_PR_DIGEST.path)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show in Finder" }));
  expect(onReveal).toHaveBeenCalledWith(SAMPLE_PR_DIGEST.path);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("a step with no line number marks nothing", async () => {
  const user = userEvent.setup();
  const steps = SAMPLE_PR_DIGEST_STEPS.map((step) => ({ ...step, lines: [null, null] as never }));
  const { container } = render(detail({ steps }));
  await user.click(screen.getByRole("tab", { name: "Code" }));
  expect(container.querySelector(".code-editor-layer")?.textContent ?? "").not.toContain("●");
});

test("the Runs tab lists this workflow's runs, each opening its session", async () => {
  const user = userEvent.setup();
  const { container } = render(detail());
  await user.click(screen.getByRole("tab", { name: "Runs" }));
  const runs = within(screen.getByRole("list", { name: "Runs" }));
  expect(runs.getAllByRole("listitem")).toHaveLength(4);
  expect(runs.getAllByRole("link")[0]?.getAttribute("href")).toBe("/s/w_wait");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the Runs tab says so when there are none, and the Triggers tab waits for 4.8.2", async () => {
  const user = userEvent.setup();
  render(detail({ runs: [] }));
  await user.click(screen.getByRole("tab", { name: "Runs" }));
  expect(screen.getByText("No runs yet.")).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Triggers" }));
  expect(screen.getByText(/come with 4\.8\.2/)).toBeTruthy();
});

test("a broken workflow shows its traceback, does not show code, and cannot run", async () => {
  const user = userEvent.setup();
  const { container } = render(detail({ workflow: SAMPLE_BROKEN, steps: [], code: null, runs: [] }));
  expect(screen.getByRole("alert").textContent).toContain("ImportError: cannot import name 'Runn'");
  expect((screen.getByRole("button", { name: "Run…" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("tab", { name: "Code" }));
  expect(screen.getByText(/not shown for a file that does not load/)).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("an untrusted workflow says it is never run", () => {
  render(detail({ workflow: SAMPLE_UNTRUSTED, steps: [], code: null, runs: [] }));
  expect(screen.getByText(/listed and never run/)).toBeTruthy();
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

test("/workflows says how many there are and how many are broken, and the rail's panel lists them", async () => {
  sidebarItemStore.set("workflows");
  mount("/workflows", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue(SAMPLE_WORKFLOW_LIST);
  });
  expect(await screen.findByRole("heading", { name: "Workflows" })).toBeTruthy();
  expect(await screen.findByText("4 workflows · 1 broken")).toBeTruthy();
  expect(await screen.findByRole("link", { name: /pr_digest/ })).toBeTruthy();
});

test("/workflows/:id loads the workflow, its code and its runs, and a pushed workflow event refreshes the runs", async () => {
  const user = userEvent.setup();
  const fake = mount(`/workflows/${encodeURIComponent(SAMPLE_PR_DIGEST.id)}`, ({ raw }) => {
    raw.getWorkflow.mockResolvedValue(SAMPLE_PR_DIGEST_GET);
    raw.listRuns.mockResolvedValue({ runs: [SAMPLE_WORKFLOW_RUNS[1]!] });
  });
  expect(await screen.findByRole("heading", { name: /pr_digest/ })).toBeTruthy();
  expect(fake.raw.getWorkflow).toHaveBeenCalledWith(SAMPLE_PR_DIGEST.id);
  await user.click(screen.getByRole("tab", { name: "Runs" }));
  expect(within(await screen.findByRole("list", { name: "Runs" })).getAllByRole("listitem")).toHaveLength(1);
  fake.raw.listRuns.mockResolvedValue({ runs: SAMPLE_WORKFLOW_RUNS });
  fake.emitWorkflow({ kind: "run", method: "workflow.run.started", params: {} as never });
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Runs" })).getAllByRole("listitem")).toHaveLength(4));
});

test("a workflow the daemon does not know says so", async () => {
  mount("/workflows/nope", ({ raw }) => {
    raw.getWorkflow.mockRejectedValue(new Error("no workflow nope"));
  });
  expect(await screen.findByText(/no workflow nope|There is no such workflow/)).toBeTruthy();
});
