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
import { lastRunLine, outlineStepOf, stepsOfOutline } from "./last-run.tsx";
import { SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_GET, SAMPLE_PR_DIGEST_HASH, SAMPLE_PR_DIGEST_LAST_RUN, SAMPLE_PR_DIGEST_STEPS, SAMPLE_WORKFLOW_RUNS } from "./sample.ts";
import { WorkflowEditor, type WorkflowEditorProps } from "./workflow-editor.tsx";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };

beforeEach(() => {
  localStorage.clear();
  sidebarItemStore.set("workflows");
});
afterEach(() => {
  history.replaceState(null, "", "/");
  sidebarItemStore.set("sessions");
});

function editor(props: Partial<WorkflowEditorProps> = {}) {
  return render(<WorkflowEditor workflow={SAMPLE_PR_DIGEST} steps={SAMPLE_PR_DIGEST_STEPS} code={SAMPLE_PR_DIGEST_CODE} codeHash={SAMPLE_PR_DIGEST_HASH} initial={{ problems: [], view: "outline" }} {...props} />);
}

test("each step card says what it gave in the last run, one line", () => {
  editor({ lastRun: SAMPLE_PR_DIGEST_LAST_RUN });
  const items = within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem");
  expect(items[0]!.textContent).toContain("Last run: 12 pull requests");
  // A loop gave one result per item.
  expect(items[1]!.textContent).toContain("Last run: 2 items: Bumps httpx to 0.28.");
  expect(items[2]!.textContent).toContain("Last run: edited");
  // A step the run has nothing for says nothing.
  expect(items[3]!.textContent).not.toContain("Last run");
});

test("with no run yet, the cards and the pane say nothing about one", () => {
  editor({ lastRun: null, initial: { problems: [], view: "outline", selected: "s2" } });
  expect(screen.queryByText(/Last run/)).toBeNull();
  expect(screen.queryByRole("region", { name: "What it gave in the last run" })).toBeNull();
});

test("the pane shows what the step gave in the last run, in its shape, with a link to that run", async () => {
  const user = userEvent.setup();
  const onOpenRun = vi.fn();
  editor({ lastRun: SAMPLE_PR_DIGEST_LAST_RUN, onOpenRun, initial: { problems: [], view: "outline", selected: "s2" } });
  const block = within(screen.getByRole("region", { name: "What it gave in the last run" }));
  expect(block.getByText("ran today 9:05")).toBeTruthy();
  expect(block.getByText("pr 1912")).toBeTruthy();
  expect(block.getByText("Fixes the typer help text.")).toBeTruthy();
  await user.click(block.getByRole("button", { name: "Open that run" }));
  expect(onOpenRun).toHaveBeenCalledWith("wr_digest");
});

test("a step the last run did not reach has no block in its pane", () => {
  editor({ lastRun: SAMPLE_PR_DIGEST_LAST_RUN, initial: { problems: [], view: "outline", selected: "s4" } });
  expect(screen.queryByRole("region", { name: "What it gave in the last run" })).toBeNull();
});

test("the last run's block passes axe", async () => {
  const { container } = editor({ lastRun: SAMPLE_PR_DIGEST_LAST_RUN, onOpenRun: vi.fn(), initial: { problems: [], view: "outline", selected: "s1" } });
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("a run's step is matched to the outline by its key, else by a title that is only one step's", () => {
  const run = SAMPLE_PR_DIGEST_LAST_RUN.steps;
  expect(stepsOfOutline(SAMPLE_PR_DIGEST_STEPS, SAMPLE_PR_DIGEST_STEPS[0]!, run)).toHaveLength(1);
  expect(stepsOfOutline(SAMPLE_PR_DIGEST_STEPS, SAMPLE_PR_DIGEST_STEPS[1]!, run)).toHaveLength(2);
  expect(stepsOfOutline(SAMPLE_PR_DIGEST_STEPS, SAMPLE_PR_DIGEST_STEPS[3]!, run)).toHaveLength(0);
  expect(outlineStepOf(SAMPLE_PR_DIGEST_STEPS, run[1]!)?.id).toBe("s2");
  // Two steps with one title cannot be told apart by it.
  const twins = [SAMPLE_PR_DIGEST_STEPS[1]!, { ...SAMPLE_PR_DIGEST_STEPS[1]!, id: "s9" }];
  expect(outlineStepOf(twins, run[1]!)).toBeNull();
  expect(lastRunLine([])).toBe("");
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

const PATH = `/workflows/${encodeURIComponent(SAMPLE_PR_DIGEST.id)}`;
const RUN = { ...SAMPLE_WORKFLOW_RUNS[1]!, workflow_run_id: "wr_digest" };

test("/workflows/:id?step= selects that step, and the last run is read once, for the newest run", async () => {
  const fake = mount(`${PATH}?step=s2`, ({ raw }) => {
    raw.getWorkflow.mockResolvedValue(SAMPLE_PR_DIGEST_GET);
    raw.listRuns.mockResolvedValue({ runs: [RUN, { ...SAMPLE_WORKFLOW_RUNS[3]!, workflow_run_id: "wr_old" }] });
    raw.workflowStatus.mockResolvedValue({ run: { ...RUN, workflow_run_id: "wr_digest", workflow_id: SAMPLE_PR_DIGEST.id, name: "pr_digest", status: "done", trigger: "manual", inputs: {}, started_at: RUN.started_at } as never, steps: SAMPLE_PR_DIGEST_LAST_RUN.steps as never, reviews: [] });
  });
  const pane = await screen.findByRole("group", { name: "Selected step" });
  expect(within(pane).getByRole("heading", { name: /Summarise each pull request/ })).toBeTruthy();
  expect(await within(pane).findByRole("region", { name: "What it gave in the last run" })).toBeTruthy();
  expect(fake.raw.workflowStatus).toHaveBeenCalledTimes(1);
  expect(fake.raw.workflowStatus).toHaveBeenCalledWith("wr_digest");
});

test("/workflows/:id with no run asks for no status and says nothing of a last run", async () => {
  const fake = mount(PATH, ({ raw }) => {
    raw.getWorkflow.mockResolvedValue(SAMPLE_PR_DIGEST_GET);
    raw.listRuns.mockResolvedValue({ runs: [] });
  });
  expect(await screen.findByRole("heading", { name: /pr_digest/ })).toBeTruthy();
  await waitFor(() => expect(fake.raw.listRuns).toHaveBeenCalled());
  expect(fake.raw.workflowStatus).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "What it gave in the last run" })).toBeNull();
});

test("Open that run goes to the run's page", async () => {
  const user = userEvent.setup();
  mount(`${PATH}?step=s1`, ({ raw }) => {
    raw.getWorkflow.mockResolvedValue(SAMPLE_PR_DIGEST_GET);
    raw.listRuns.mockResolvedValue({ runs: [RUN] });
    raw.workflowStatus.mockResolvedValue({ run: { ...RUN, workflow_id: SAMPLE_PR_DIGEST.id, name: "pr_digest", status: "done", trigger: "manual", inputs: {} } as never, steps: SAMPLE_PR_DIGEST_LAST_RUN.steps as never, reviews: [] });
  });
  await user.click(await screen.findByRole("button", { name: "Open that run" }));
  await waitFor(() => expect(window.location.pathname).toBe("/runs/wr_digest"));
});
