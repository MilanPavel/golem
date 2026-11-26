import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import type { RunInfo } from "../../store/runs.ts";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { sidebarItemStore } from "../sidebar/sidebar-item.ts";
import { RunRow } from "./runs-list.tsx";
import { RUNS_NOW } from "./sample.ts";
import { WorkflowRunView, type WorkflowRunViewProps } from "./workflow-run-view.tsx";
import { SAMPLE_RUN_CANCELLED, SAMPLE_RUN_DONE, SAMPLE_RUN_FAILED, SAMPLE_RUN_REVIEW, SAMPLE_RUN_RUNNING, SAMPLE_RUN_TOOL_ASK, WORKFLOW_RUN_NOW, type WorkflowRunSample } from "./workflow-sample.ts";

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
    chatPath: (child) => `/s/${child}?lead=s_digest`,
    onNavigate: vi.fn(),
    onCancel: vi.fn(async () => {}),
    onResume: vi.fn(async () => {}),
    onAnswer: vi.fn(async () => {}),
    trace: <p>The trace.</p>,
    ...extra,
  };
  return { props, ...render(<WorkflowRunView {...props} />) };
}

test("the steps list shows each step's state, time, model, cost and the line of its output", () => {
  view(SAMPLE_RUN_DONE);
  const rows = screen.getAllByRole("listitem").filter((item) => item.hasAttribute("data-step-row"));
  expect(rows).toHaveLength(5);
  expect(within(rows[1]!).getByText("summarise")).toBeTruthy();
  expect(rows[1]!.textContent).toContain("llm · deepseek/deepseek-chat · $0.01");
  expect(rows[1]!.textContent).toContain("Twelve open pull requests.");
  expect(rows[0]!.textContent).toContain("12 pull requests");
  // A worker shows its diff, a review its answer.
  expect(rows[3]!.textContent).toContain("2 files · +6 −2 · checks passed");
  expect(rows[4]!.textContent).toContain("edited and approved");
});

test("a row opens its whole output, and an agent step opens its chat", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_DONE);
  const summarise = screen.getByRole("button", { name: /summarise/ });
  expect(summarise.getAttribute("aria-expanded")).toBe("false");
  await user.click(summarise);
  expect(summarise.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByLabelText("Output of summarise").textContent).toContain("Five wait on a review from you.");
  await user.click(screen.getByRole("button", { name: /^reviewer/ }));
  await user.click(screen.getByRole("link", { name: "Open chat" }));
  expect(props.onNavigate).toHaveBeenCalledWith("/s/s_reviewer?lead=s_digest");
});

test("a worker row unfolds its copy, its changes and its checks", async () => {
  view(SAMPLE_RUN_DONE);
  await userEvent.setup().click(screen.getByRole("button", { name: /worker · typer/ }));
  const open = within(document.querySelector("[data-row-open]:not([hidden])") as HTMLElement);
  expect(open.getByText("wf-typer-1")).toBeTruthy();
  expect(open.getByText("2 files, +6 −2")).toBeTruthy();
  expect(open.getByText("passed")).toBeTruthy();
});

test("a review shows its draft in a field, and Approve answers without text", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_REVIEW);
  const card = within(screen.getByRole("region", { name: "Review, Send this digest?" }));
  expect((card.getByRole("textbox", { name: "Draft" }) as HTMLTextAreaElement).value).toContain("Twelve pull requests are open.");
  await user.click(card.getByRole("button", { name: "Approve" }));
  expect(props.onAnswer).toHaveBeenCalledWith("review:Send this?", "approve", undefined);
});

test("Edit and approve sends the changed text, and an empty one is not sent", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_REVIEW);
  const card = within(screen.getByRole("region", { name: "Review, Send this digest?" }));
  const field = card.getByRole("textbox", { name: "Draft" });
  await user.clear(field);
  await user.click(card.getByRole("button", { name: "Edit and approve" }));
  expect(card.getByRole("alert").textContent).toContain("Write what to send");
  expect(props.onAnswer).not.toHaveBeenCalled();
  await user.type(field, "Short digest");
  await user.click(card.getByRole("button", { name: "Edit and approve" }));
  expect(props.onAnswer).toHaveBeenCalledWith("review:Send this?", "edit", "Short digest");
});

test("Reject asks for a reason first, and sends it", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_REVIEW);
  const card = within(screen.getByRole("region", { name: "Review, Send this digest?" }));
  await user.click(card.getByRole("button", { name: "Reject…" }));
  await user.type(card.getByRole("textbox", { name: /Why not/ }), "Too long");
  await user.click(card.getByRole("button", { name: "Send rejection" }));
  expect(props.onAnswer).toHaveBeenCalledWith("review:Send this?", "reject", "Too long");
});

test("an answer the daemon refuses stays on the card with its reason", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_REVIEW, { onAnswer: vi.fn(async () => Promise.reject(new Error("review is answered already"))) });
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect((await screen.findByRole("alert")).textContent).toContain("review is answered already");
});

test("a tool ask is the same card, titled Run <tool>? with its arguments and no edit", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_TOOL_ASK);
  const card = within(screen.getByRole("region", { name: "Review, Run gh_pr_create?" }));
  expect(card.getByLabelText("Arguments of gh_pr_create").textContent).toContain('"title": "Bump typer to 0.13"');
  expect(card.queryByRole("button", { name: "Edit and approve" })).toBeNull();
  expect(card.getByText(/your tool rules/)).toBeTruthy();
  await user.click(card.getByRole("button", { name: "Approve" }));
  expect(props.onAnswer).toHaveBeenCalledWith("tool:gh_pr_create:1", "approve", undefined);
});

test("several open reviews each get a card", () => {
  view({ ...SAMPLE_RUN_REVIEW, reviews: [...SAMPLE_RUN_REVIEW.reviews, ...SAMPLE_RUN_TOOL_ASK.reviews] });
  expect(screen.getAllByText("The run waits for your answer. It holds no model and no slot.")).toHaveLength(2);
});

test("a running run can be cancelled, and the button says why when it fails", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn(async () => Promise.reject(new Error("daemon is gone")));
  view(SAMPLE_RUN_RUNNING, { onCancel });
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).toHaveBeenCalled();
  expect((await screen.findByRole("alert")).textContent).toContain("daemon is gone");
});

test("a failed run shows its error and resumes from the header and from the failed step", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_FAILED);
  expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
  expect(screen.getAllByText("tool mcp__github__list_pull_requests: needs sign-in").length).toBeGreaterThan(1);
  await user.click(screen.getByRole("button", { name: "Resume" }));
  expect(props.onResume).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: /list_pull_requests/ }));
  await user.click(screen.getByRole("button", { name: "Resume from here" }));
  expect(props.onResume).toHaveBeenCalledTimes(2);
});

test("a cancelled and a done run offer neither Cancel nor Resume", () => {
  for (const sample of [SAMPLE_RUN_CANCELLED, SAMPLE_RUN_DONE]) {
    const { unmount } = view(sample);
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    unmount();
  }
});

test("the Trace tab holds what the page gives it", async () => {
  view(SAMPLE_RUN_DONE);
  await userEvent.setup().click(screen.getByRole("tab", { name: "Trace" }));
  expect(screen.getByText("The trace.")).toBeTruthy();
});

test("every state passes axe", async () => {
  for (const sample of [SAMPLE_RUN_RUNNING, SAMPLE_RUN_REVIEW, SAMPLE_RUN_TOOL_ASK, SAMPLE_RUN_FAILED, SAMPLE_RUN_CANCELLED, SAMPLE_RUN_DONE]) {
    const { container, unmount } = view(sample);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    // And with every row open.
    for (const button of container.querySelectorAll("button[aria-expanded=false]")) fireEvent.click(button);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    unmount();
  }
});

test("a workflow row in the Runs list opens the run, not its session", async () => {
  const onNavigate = vi.fn();
  const workflow: RunInfo = { session_id: "s_digest", kind: "workflow", origin: "workflow:pr_digest", status: "running", approvals: 0, started_at: new Date(RUNS_NOW).toISOString(), workflow_run_id: "wr/1" };
  const { rerender } = render(<RunRow run={workflow} now={RUNS_NOW} onNavigate={onNavigate} />);
  await userEvent.setup().click(screen.getByRole("link"));
  expect(onNavigate).toHaveBeenCalledWith("/runs/wr%2F1");
  rerender(<RunRow run={{ ...workflow, kind: "ask", workflow_run_id: null }} now={RUNS_NOW} onNavigate={onNavigate} />);
  await userEvent.setup().click(screen.getByRole("link"));
  expect(onNavigate).toHaveBeenLastCalledWith("/s/s_digest");
});

const STATUS = (id: string, extra: Record<string, unknown> = {}) => ({
  run: { ...SAMPLE_RUN_REVIEW.run, workflow_run_id: id, ...extra },
  steps: SAMPLE_RUN_REVIEW.steps,
  reviews: SAMPLE_RUN_REVIEW.reviews,
});

function mount(path: string, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.workflowStatus.mockResolvedValue(STATUS("wr_1"));
  setup?.(fake);
  const source = { subscribe: () => () => {}, getSnapshot: () => CONNECTED };
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
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

test("/runs/:id reads workflow.status, answers a review through the client, and follows workflow events", async () => {
  const fake = mount("/runs/wr_1");
  const card = within(await screen.findByRole("region", { name: "Review, Send this digest?" }));
  expect(fake.raw.workflowStatus).toHaveBeenCalledWith("wr_1");
  fireEvent.click(card.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(fake.raw.answerWorkflowReview).toHaveBeenCalledWith("wr_1", "review:Send this?", "approve", undefined));
  // The answer marks the status stale; so does a step event from the daemon.
  fake.raw.workflowStatus.mockResolvedValue({ ...STATUS("wr_1", { status: "done", finished_at: SAMPLE_RUN_DONE.run.finished_at }), reviews: [] });
  const before = fake.raw.workflowStatus.mock.calls.length;
  act(() => {
    fake.emitWorkflow({ kind: "run", method: "workflow.run.done", params: { ...SAMPLE_RUN_DONE.run } as never });
  });
  await waitFor(() => expect(fake.raw.workflowStatus.mock.calls.length).toBeGreaterThan(before));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Review, Send this digest?" })).toBeNull());
  expect(within(screen.getByRole("heading", { level: 1 })).getByText("done")).toBeTruthy();
});

test("/runs/:id says so when the run does not exist", async () => {
  mount("/runs/nope", (fake) => fake.raw.workflowStatus.mockRejectedValue(new Error("no workflow run nope")));
  expect(await screen.findByText("no workflow run nope")).toBeTruthy();
});
