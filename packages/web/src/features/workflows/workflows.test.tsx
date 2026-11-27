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
import { SAMPLE_BROKEN, SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_GET, SAMPLE_PR_DIGEST_STEPS, SAMPLE_BRIEFING, SAMPLE_PROJECT_STARTER, SAMPLE_STARTER_FOLDER, SAMPLE_STARTERS, SAMPLE_UNTRUSTED, SAMPLE_WORKFLOW_LIST, SAMPLE_WORKFLOW_LIST_TWO_PROJECTS, SAMPLE_WORKFLOW_RUNS, WORKFLOWS_NOW } from "./sample.ts";
import { SAMPLE_MORNING_BRIEF, SAMPLE_WORKFLOW_ROUTINE, SAMPLE_WORKFLOW_WATCH_ROUTINE } from "../routines/sample.ts";
import { routinesStarting, stepLines, workflowGroups, workflowRuns } from "./text.ts";
import { WorkflowDetail } from "./workflow-detail.tsx";
import { WorkflowsPanel } from "./workflows-panel.tsx";
import { WorkflowStarters, WorkflowsEmpty, starterStillToAdd } from "./workflows-empty.tsx";

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

test("under the workflows a Starters group lists the starters not added yet, each opening /workflows", async () => {
  const onNavigate = vi.fn();
  const { container, rerender } = render(<WorkflowsPanel list={SAMPLE_WORKFLOW_LIST} starters={SAMPLE_STARTERS} selected={null} onNavigate={onNavigate} />);
  const group = within(screen.getByRole("list", { name: "Starters" }));
  const link = group.getByRole("link", { name: /Morning briefing/ });
  expect(link.getAttribute("href")).toBe("/workflows");
  await userEvent.setup().click(link);
  expect(onNavigate).toHaveBeenCalledWith("/workflows");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  rerender(<WorkflowsPanel list={SAMPLE_WORKFLOW_LIST} starters={[]} selected={null} onNavigate={onNavigate} />);
  expect(screen.queryByRole("list", { name: "Starters" })).toBeNull();
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
  expect(workflowRuns([...SAMPLE_WORKFLOW_RUNS, other, routine], "pr_digest")).toHaveLength(SAMPLE_WORKFLOW_RUNS.length + 1);
});

function detail(extra: Partial<Parameters<typeof WorkflowDetail>[0]> = {}) {
  return (
    <WorkflowDetail workflow={SAMPLE_PR_DIGEST} steps={SAMPLE_PR_DIGEST_STEPS} code={SAMPLE_PR_DIGEST_CODE} runs={SAMPLE_WORKFLOW_RUNS} now={WORKFLOWS_NOW} onNavigate={() => {}} {...extra} />
  );
}

test("the header shows the name, the state and the description on one line, and the tabs are Code, Runs and Triggers", async () => {
  const { container } = render(detail());
  expect(screen.getByRole("heading", { name: /pr_digest/ })).toBeTruthy();
  const description = screen.getByText("One line for each open pull request, checked by you, then a notice.");
  expect(description.getAttribute("title")).toBe(SAMPLE_PR_DIGEST.description);
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Code", "Runs", "Triggers"]);
  expect(screen.getByRole("tab", { name: "Code" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("table", { name: "Inputs" })).toBeNull();
  // Without a way to start, Run… is there and disabled.
  expect((screen.getByRole("button", { name: "Run…" }) as HTMLButtonElement).disabled).toBe(true);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the Triggers tab says By hand with no routine, and shows a routine's next run", async () => {
  const user = userEvent.setup();
  const { unmount } = render(detail({ initialTab: "triggers" }));
  expect(screen.getByText("Starts: By hand")).toBeTruthy();
  expect(screen.getByText(/No routine starts this workflow/)).toBeTruthy();
  unmount();
  render(detail({ routines: [SAMPLE_WORKFLOW_ROUTINE] }));
  await user.click(screen.getByRole("tab", { name: "Triggers" }));
  expect(screen.getByRole("list", { name: "Routines that start it" }).textContent).toMatch(/next in \d+ h/); // WORKFLOWS_NOW is local time and next_at is fixed at +01:00, so the hours depend on the time zone.
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

test("the Runs tab says so when there are none", async () => {
  const user = userEvent.setup();
  render(detail({ runs: [] }));
  await user.click(screen.getByRole("tab", { name: "Runs" }));
  expect(screen.getByText("No runs yet.")).toBeTruthy();
});

test("the Triggers tab lists the routines that start the workflow, each with its schedule or watch and a link", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const { container } = render(detail({ routines: [SAMPLE_WORKFLOW_ROUTINE, SAMPLE_WORKFLOW_WATCH_ROUTINE], onNavigate }));
  await user.click(screen.getByRole("tab", { name: "Triggers" }));
  const rows = within(screen.getByRole("list", { name: "Routines that start it" })).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("weekday-pr-digest");
  expect(rows[0]?.textContent).toContain("Weekdays at 09:00 · repo=MilanPavel/golem, since=1d");
  expect(rows[1]?.textContent).toContain("New *.pdf in ~/Downloads · repo=MilanPavel/golem");
  const link = within(rows[0]!).getByRole("link", { name: /Open routine/ });
  expect(link.getAttribute("href")).toBe("/routines/weekday-pr-digest");
  await user.click(link);
  expect(onNavigate).toHaveBeenCalledWith("/routines/weekday-pr-digest");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the Triggers tab says no routine starts the workflow, with a way to make one", async () => {
  const user = userEvent.setup();
  render(detail({ routines: [] }));
  await user.click(screen.getByRole("tab", { name: "Triggers" }));
  expect(screen.getByText(/No routine starts this workflow/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Routines" }).getAttribute("href")).toBe("/routines?new");
});

test("routinesStarting picks the routines whose workflow is this one", () => {
  expect(routinesStarting([SAMPLE_WORKFLOW_ROUTINE, SAMPLE_WORKFLOW_WATCH_ROUTINE, SAMPLE_MORNING_BRIEF], "pr_digest")).toHaveLength(2);
  expect(routinesStarting([SAMPLE_MORNING_BRIEF], "pr_digest")).toEqual([]);
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

const GO = { ...SAMPLE_PR_DIGEST, inputs: [...(SAMPLE_PR_DIGEST.inputs ?? []), { name: "limit", type: "int", default: "5" }, { name: "dry", type: "bool", default: "False" }, { name: "mode", type: 'Literal["fast", "slow"]' }, { name: "where", type: "Path" }] };

test("Run… opens a form from the inputs, marks the required ones and starts with what was typed", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn(() => Promise.resolve());
  const { baseElement } = render(detail({ workflow: GO, onStart, onChooseFolder: async () => "/Users/you/repos/golem" }));
  await user.click(screen.getByRole("button", { name: "Run…" }));
  const dialog = within(screen.getByRole("dialog", { name: "Run pr_digest" }));
  expect((dialog.getByLabelText("since") as HTMLInputElement).value).toBe("1d");
  expect((dialog.getByLabelText("limit") as HTMLInputElement).value).toBe("5");
  expect(dialog.getByText("str · default 1d")).toBeTruthy();
  // Nothing typed: the required fields complain, and nothing starts.
  await user.click(dialog.getByRole("button", { name: "Run" }));
  expect(dialog.getAllByText("Required.")).toHaveLength(4);
  expect(onStart).not.toHaveBeenCalled();
  await user.type(dialog.getByLabelText(/^tool/), "gh");
  await user.type(dialog.getByLabelText(/^repo/), "MilanPavel/golem");
  await user.selectOptions(dialog.getByLabelText(/^mode/), "fast");
  await user.click(dialog.getByRole("button", { name: "Choose a folder for where" }));
  await waitFor(() => expect((dialog.getByLabelText(/^where/) as HTMLInputElement).value).toBe("/Users/you/repos/golem"));
  await user.clear(dialog.getByLabelText("limit"));
  await user.type(dialog.getByLabelText("limit"), "x");
  await user.click(dialog.getByRole("button", { name: "Run" }));
  expect(dialog.getByText("Enter a number.")).toBeTruthy();
  await user.clear(dialog.getByLabelText("limit"));
  await user.type(dialog.getByLabelText("limit"), "7");
  await user.click(dialog.getByLabelText("dry"));
  expect((await axe.run(baseElement, noContrast)).violations).toEqual([]);
  await user.click(dialog.getByRole("button", { name: "Run" }));
  expect(onStart).toHaveBeenCalledWith({ tool: "gh", repo: "MilanPavel/golem", since: "1d", limit: 7, dry: true, mode: "fast", where: "/Users/you/repos/golem" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("an error from the start stays in the dialog and Run works again", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn(() => Promise.reject(new Error("The folder is not trusted.")));
  render(detail({ workflow: { ...SAMPLE_PR_DIGEST, inputs: [{ name: "repo", type: "str", default: '"x"' }] }, onStart }));
  await user.click(screen.getByRole("button", { name: "Run…" }));
  await user.click(screen.getByRole("button", { name: "Run" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The folder is not trusted.");
  expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Run… is disabled for a broken workflow", () => {
  render(detail({ workflow: SAMPLE_BROKEN, onStart: () => Promise.resolve() }));
  expect((screen.getByRole("button", { name: "Run…" }) as HTMLButtonElement).disabled).toBe(true);
});

test("/workflows/:id: Run starts the workflow and opens the run by its id", async () => {
  const user = userEvent.setup();
  const fake = mount(`/workflows/${encodeURIComponent(SAMPLE_PR_DIGEST.id)}`, ({ raw }) => {
    raw.getWorkflow.mockResolvedValue(SAMPLE_PR_DIGEST_GET);
  });
  await user.click(await screen.findByRole("button", { name: "Run…" }));
  await user.type(screen.getByLabelText(/^tool/), "gh");
  await user.type(screen.getByLabelText(/^repo/), "MilanPavel/golem");
  await user.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(location.pathname).toBe("/runs/wr_1"));
  expect(fake.raw.startWorkflow).toHaveBeenCalledWith(SAMPLE_PR_DIGEST.id, { tool: "gh", repo: "MilanPavel/golem", since: "1d" });
});

const BOTH = [SAMPLE_BRIEFING, SAMPLE_PROJECT_STARTER];
const cardOf = (title: string) => within(screen.getAllByRole("listitem").find((item) => item.textContent?.includes(title))!);

test("the empty state shows a starter card whose line says when it runs, and adds it through the daemon", async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn(async () => {});
  const { container } = render(<WorkflowsEmpty starters={SAMPLE_STARTERS} folder={null} onAdd={onAdd} />);
  expect(screen.getByRole("heading", { name: "No workflows yet" })).toBeTruthy();
  const card = cardOf("Morning briefing");
  expect(card.getByRole("heading").textContent).toBe("Morning briefing");
  expect(card.getByText(/Every weekday at 07:30/)).toBeTruthy();
  await user.click(card.getByRole("button", { name: "Use this starter" }));
  expect(onAdd).toHaveBeenCalledWith(SAMPLE_BRIEFING);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("without a project folder a project starter says why and its button is off, and the others work", () => {
  render(<WorkflowsEmpty starters={BOTH} folder={null} onAdd={async () => {}} />);
  const review = cardOf("Review the changes");
  const button = review.getByRole("button", { name: "Use this starter" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(review.getByText(/This one works on a project/)).toBeTruthy();
  expect(button.getAttribute("aria-describedby")).toBeTruthy();
  expect((cardOf("Morning briefing").getByRole("button", { name: "Use this starter" }) as HTMLButtonElement).disabled).toBe(false);
});

test("with a project folder a project starter's button is on", () => {
  render(<WorkflowsEmpty starters={BOTH} folder={SAMPLE_STARTER_FOLDER} onAdd={async () => {}} />);
  expect((cardOf("Review the changes").getByRole("button", { name: "Use this starter" }) as HTMLButtonElement).disabled).toBe(false);
});

test("a refused add shows the daemon's reason on its card and the button works again", async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn(async () => {
    throw new Error("/x is not trusted; add it to trusted_projects in config.toml first");
  });
  render(<WorkflowsEmpty starters={SAMPLE_STARTERS} folder="/x" onAdd={onAdd} />);
  const card = cardOf("Morning briefing");
  await user.click(card.getByRole("button", { name: "Use this starter" }));
  expect((await card.findByRole("alert")).textContent).toContain("trusted_projects");
  expect((card.getByRole("button", { name: "Use this starter" }) as HTMLButtonElement).disabled).toBe(false);
});

test("starterStillToAdd drops a starter whose file is in the project folder or in your own folder", () => {
  const entry = (name: string, project: string | null) => ({ ...SAMPLE_PR_DIGEST, id: `${project}/${name}`, name, project });
  const left = (list: ReturnType<typeof entry>[], folder: string | null) => starterStillToAdd(BOTH, list, folder).map((starter) => starter.id);
  expect(left([], "/p")).toEqual(["morning_briefing", "review_changes"]);
  expect(left([entry("morning_briefing", null), entry("review_changes", "/p")], "/p")).toEqual([]);
  // Another project's file of that name does not count; a project starter with no folder is still to add.
  expect(left([entry("review_changes", "/other")], "/p")).toContain("review_changes");
  expect(left([entry("review_changes", "/p")], null)).toContain("review_changes");
  expect(left([entry("morning_briefing", "/p")], "/p")).toContain("morning_briefing");
});

test("the Starters section shows nothing once every starter is added", () => {
  const { container } = render(<WorkflowStarters starters={[]} folder="/p" onAdd={async () => {}} />);
  expect(container.textContent).toBe("");
});

test("/workflows with none lists the starter, adds it in your own folder and opens it", async () => {
  const user = userEvent.setup();
  const id = "/h/.golem/workflows/morning_briefing.py::morning_briefing";
  const fake = mount("/workflows", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [] });
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
    raw.addWorkflowStarter.mockResolvedValue({ id, name: "morning_briefing", path: "/h/.golem/workflows/morning_briefing.py" });
  });
  act(() => fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", SAMPLE_STARTER_FOLDER)));
  expect(await screen.findByRole("heading", { name: "No workflows yet" })).toBeTruthy();
  expect(screen.getByText(/Every weekday at 07:30/)).toBeTruthy();
  await user.click(await screen.findByRole("button", { name: "Use this starter" }));
  await waitFor(() => expect(location.pathname).toBe(`/workflows/${encodeURIComponent(id)}`));
  expect(fake.raw.addWorkflowStarter).toHaveBeenCalledWith("morning_briefing");
});

test("/workflows shows a refusal of the add on the card and stays on the page", async () => {
  const user = userEvent.setup();
  const fake = mount("/workflows", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [] });
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
    raw.addWorkflowStarter.mockRejectedValue(new Error("/h/.golem/workflows/morning_briefing.py exists already; it was not changed"));
  });
  await user.click(await screen.findByRole("button", { name: "Use this starter" }));
  expect((await screen.findByRole("alert")).textContent).toContain("exists already");
  expect(fake.raw.addWorkflowStarter).toHaveBeenCalledTimes(1);
  expect(location.pathname).toBe("/workflows");
});

test("/workflows with some workflows shows the Starters section until the starter is added", async () => {
  mount("/workflows", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue(SAMPLE_WORKFLOW_LIST);
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
  });
  expect(await screen.findByRole("heading", { name: "Starters" })).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Starter workflows" })).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Morning briefing"]);
});

test("/workflows hides the Starters section once the starter is among the workflows", async () => {
  mount("/workflows", ({ raw }) => {
    raw.listWorkflows.mockResolvedValue({ workflows: [...SAMPLE_WORKFLOW_LIST.workflows, { ...SAMPLE_PR_DIGEST, id: "/h/morning_briefing.py::morning_briefing", name: "morning_briefing", project: undefined }] });
    raw.listWorkflowStarters.mockResolvedValue({ starters: SAMPLE_STARTERS });
  });
  expect(await screen.findByText("5 workflows · 1 broken")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Starters" })).toBeNull();
});
