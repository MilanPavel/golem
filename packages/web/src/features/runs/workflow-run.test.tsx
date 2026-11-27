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
import { SAMPLE_BRIEFING_PATH, SAMPLE_FILE_CUT, SAMPLE_FILE_READ, SAMPLE_RESULTS, SAMPLE_RUN_CANCELLED, SAMPLE_RUN_DONE, SAMPLE_RUN_FAILED, SAMPLE_RUN_FILE, SAMPLE_RUN_LOOP, SAMPLE_RUN_LOOP_MIDWAY, SAMPLE_RUN_OUTPUTS, SAMPLE_RUN_PARALLEL, SAMPLE_RUN_REVIEW, SAMPLE_RUN_RUNNING, SAMPLE_RUN_STREAMING, SAMPLE_RUN_TEXT, SAMPLE_RUN_TOOL_ASK, SAMPLE_RUN_UNKNOWN_TOTAL, WORKFLOW_RUN_NOW, type WorkflowRunSample } from "./workflow-sample.ts";

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

const rowsOf = () => Array.from(document.querySelectorAll("[data-step-row]"));

test("the steps list is vertical: each step's state, time and the line of its output", () => {
  view(SAMPLE_RUN_DONE);
  const rows = rowsOf();
  expect(rows).toHaveLength(5);
  expect(within(rows[1] as HTMLElement).getByText("summarise")).toBeTruthy();
  expect(rows[1]!.textContent).toContain("37s");
  expect(rows[1]!.textContent).toContain("Twelve open pull requests.");
  expect(rows[0]!.textContent).toContain("12 pull requests");
  expect(rows[0]!.textContent).toContain("3s");
  // A worker shows its diff, a review its answer.
  expect(rows[3]!.textContent).toContain("2 files · +6 −2 · checks passed");
  expect(rows[4]!.textContent).toContain("edited and approved");
});

test("one bar and a count say how far the run is", () => {
  view(SAMPLE_RUN_RUNNING);
  expect(screen.getByText("2 of 5 steps")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("2");
  expect(bar.getAttribute("aria-valuemax")).toBe("5");
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
});

test("with no total to count against the words say so far and the bar has no end", () => {
  view(SAMPLE_RUN_UNKNOWN_TOTAL);
  expect(screen.getByText("3 steps so far")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBeNull();
  expect(bar.getAttribute("aria-valuemax")).toBeNull();
  expect(bar.getAttribute("aria-valuetext")).toBe("3 steps so far");
  expect(screen.queryByText(/ of \d+ steps/)).toBeNull();
});

test("a run that is over counts the steps it had, whatever was expected", () => {
  view({ ...SAMPLE_RUN_DONE, run: { ...SAMPLE_RUN_DONE.run, steps_expected: 9 } });
  expect(screen.getByText("5 of 5 steps")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("5");
});

test("what runs now is a vertical list with how long, and a loop row says its place against the total", () => {
  view(SAMPLE_RUN_LOOP_MIDWAY);
  const now = within(screen.getByRole("list", { name: "Working now" }));
  const lines = now.getAllByRole("listitem");
  expect(lines).toHaveLength(1);
  expect(lines[0]!.textContent).toContain("Reading feed 13 of 30 · feed-13.example.com/rss");
  expect(lines[0]!.textContent).toMatch(/\d+s/);
  expect(screen.getByRole("button", { name: /^Reading feed, 12 of 30/ })).toBeTruthy();
  // The squares still to come are drawn, so the row is 30 squares wide.
  expect(document.querySelectorAll("[data-fold] [aria-hidden='true'] > span")).toHaveLength(30);
});

test("a repeating row that was not told its total counts the ones done so far, never a total it made up", () => {
  const steps = SAMPLE_RUN_LOOP_MIDWAY.steps.map((step) => ({ ...step, of: null }));
  view({ ...SAMPLE_RUN_LOOP_MIDWAY, steps });
  expect(screen.getByRole("button", { name: /^Reading feed, 12 so far/ })).toBeTruthy();
  expect(document.querySelectorAll("[data-fold] [aria-hidden='true'] > span")).toHaveLength(13);
});

test("steps that go at once are each a line of what runs now", () => {
  view(SAMPLE_RUN_PARALLEL);
  const lines = within(screen.getByRole("list", { name: "Working now" })).getAllByRole("listitem");
  expect(lines.map((line) => line.querySelector("span")?.textContent)).toEqual(["Read log · app.log", "Fetch feed · example.com/rss", "Read calendar · today"]);
  expect(screen.getByText("1 of 4 steps")).toBeTruthy();
});

test("the header has the workflow's title with its state, and the goal under it", () => {
  view(SAMPLE_RUN_TEXT);
  const heading = within(screen.getAllByRole("heading", { level: 1 })[0]!);
  expect(heading.getByText("Morning briefing")).toBeTruthy();
  expect(heading.getByText("done")).toBeTruthy();
  expect(screen.getByText("Tell me what needs me today.")).toBeTruthy();
  expect(screen.getAllByText("3 things need you").length).toBeGreaterThan(0);
});

test("a step opens its output in the place of the result, with its chat", async () => {
  const user = userEvent.setup();
  const { props } = view(SAMPLE_RUN_DONE);
  await user.click(screen.getByRole("button", { name: /^summarise/ }));
  expect(screen.getByLabelText("Output of summarise").textContent).toContain("Five wait on a review from you.");
  await user.click(screen.getByRole("button", { name: /^reviewer/ }));
  await user.click(screen.getByRole("link", { name: "Open chat" }));
  expect(props.onNavigate).toHaveBeenCalledWith("/s/s_reviewer?lead=s_digest");
  await user.click(screen.getByRole("button", { name: /^Result/ }));
  expect(screen.getByRole("group", { name: "What it did" })).toBeTruthy();
});

test("a worker step shows its copy, its changes and its checks", async () => {
  view(SAMPLE_RUN_DONE);
  await userEvent.setup().click(screen.getByRole("button", { name: /^worker · typer/ }));
  const open = within(screen.getByLabelText("Output of worker · typer"));
  expect(open.getByText("wf-typer-1")).toBeTruthy();
  expect(open.getByText("2 files, +6 −2")).toBeTruthy();
  expect(open.getByText("passed")).toBeTruthy();
});

test("a run with no result says what it did, from its tool, review and notify steps", () => {
  view(SAMPLE_RUN_DONE);
  const did = within(screen.getByRole("group", { name: "What it did" }));
  expect(did.getByText("list_pull_requests")).toBeTruthy();
  expect(did.getByText("12 pull requests")).toBeTruthy();
  expect(did.getByText("Send this digest?")).toBeTruthy();
  expect(did.getByText("edited and approved · Hi team, twelve pull requests are open.")).toBeTruthy();
  expect(did.queryByText("summarise")).toBeNull();
});

test("a text result is drawn as Markdown, with Readable and Raw", async () => {
  view(SAMPLE_RUN_TEXT);
  const result = within(screen.getByRole("group", { name: "Result: Morning briefing" }));
  expect(result.getByRole("heading", { name: "Morning briefing" })).toBeTruthy();
  expect(result.getAllByRole("listitem")).toHaveLength(2);
  await userEvent.setup().click(result.getByRole("button", { name: "Raw" }));
  expect(result.getByText(/^# Morning briefing/)).toBeTruthy();
});

test("a table and a link result come out by their kind, the others as tabs", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_OUTPUTS);
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Steps", "Trace", "Report", "Failing checks", "Pull request"]);
  await user.click(screen.getByRole("tab", { name: "Failing checks" }));
  expect(within(screen.getByRole("group", { name: "Result: Failing checks" })).getAllByRole("row")).toHaveLength(4);
  await user.click(screen.getByRole("tab", { name: "Pull request" }));
  expect(screen.getByRole("link", { name: "https://github.com/golem/golem/pull/1921" })).toBeTruthy();
});

test("a record and a changes result come out by their kind", () => {
  const record = SAMPLE_RESULTS.find(([kind]) => kind === "record")![1];
  const changes = SAMPLE_RESULTS.find(([kind]) => kind === "changes")![1];
  const { unmount } = view({ ...SAMPLE_RUN_TEXT, run: { ...SAMPLE_RUN_TEXT.run, outputs: [{ title: "State", value: record as never }] } });
  expect(screen.getByText("not_pushed").nextElementSibling?.textContent).toBe("2");
  unmount();
  view({ ...SAMPLE_RUN_TEXT, run: { ...SAMPLE_RUN_TEXT.run, outputs: [{ title: "Work", value: changes as never }] } });
  expect(screen.getByText("1 file, +6 −2")).toBeTruthy();
});

test("a run that marked nothing shows what it returned", () => {
  view({ ...SAMPLE_RUN_DONE, run: { ...SAMPLE_RUN_DONE.run, result: { branch: "main", commits: 3 } } });
  expect(screen.getByText("commits").nextElementSibling?.textContent).toBe("3");
});

test("a file result is read through workflow.read_output and its Markdown drawn", async () => {
  const onReadOutput = vi.fn(async () => SAMPLE_FILE_READ);
  view(SAMPLE_RUN_FILE, { onReadOutput });
  const file = within(screen.getByRole("group", { name: "Result: Briefing file" }));
  expect(await file.findByRole("heading", { name: "Morning briefing" })).toBeTruthy();
  expect(onReadOutput).toHaveBeenCalledWith(0);
  expect(file.getByText(SAMPLE_BRIEFING_PATH)).toBeTruthy();
  expect(file.queryByRole("status")).toBeNull();
});

test("a file that was cut says so, and one that cannot be read says why", async () => {
  const { unmount } = view(SAMPLE_RUN_FILE, { onReadOutput: vi.fn(async () => SAMPLE_FILE_CUT) });
  expect((await screen.findByRole("status")).textContent).toContain("cut here");
  expect(screen.getByRole("status").textContent).toContain("482,113 bytes");
  unmount();
  view(SAMPLE_RUN_FILE, { onReadOutput: vi.fn(async () => Promise.reject(new Error("a file in a secret folder is not read"))) });
  expect(await screen.findByText("a file in a secret folder is not read")).toBeTruthy();
  expect(screen.getByText(SAMPLE_BRIEFING_PATH)).toBeTruthy();
});

test("a loop of thirty steps is one row, as long as the page of nine", async () => {
  const user = userEvent.setup();
  view(SAMPLE_RUN_LOOP);
  expect(rowsOf()).toHaveLength(2);
  const fold = screen.getByRole("button", { name: /^Read each feed, 26 of 30/ });
  expect(fold.getAttribute("aria-expanded")).toBe("false");
  await user.click(fold);
  // Only the items that work or failed: three working and one failed.
  const items = within(document.querySelector("[data-fold]") as HTMLElement).getAllByRole("button", { name: /feed-/ });
  expect(items).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: "Show all 30" }));
  expect(within(document.querySelector("[data-fold]") as HTMLElement).getAllByRole("button", { name: /feed-/ })).toHaveLength(30);
  // One of its items is picked like a step.
  await user.click(screen.getByRole("button", { name: /feed-5\.example\.com, failed/ }));
  expect(screen.getByText("the feed did not answer", { selector: "p" })).toBeTruthy();
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

test("a failed run offers Why did this fail?: it asks golem with the failed step and shows the answer", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn(async () => "The sign-in ran out. Sign in again and resume.");
  view(SAMPLE_RUN_FAILED, { onAsk });
  await user.click(screen.getByRole("button", { name: "Why did this fail?" }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  const question = (onAsk.mock.calls[0] as unknown as [string])[0];
  expect(question).toContain("Why did this fail?");
  expect(question).toContain('"list_pull_requests" failed with: tool mcp__github__list_pull_requests: needs sign-in');
  const answer = within(await screen.findByRole("group", { name: "Answer" }));
  expect(answer.getByText("The sign-in ran out. Sign in again and resume.")).toBeTruthy();
  expect(answer.getByText("Answer · nothing is changed")).toBeTruthy();
  await user.click(answer.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("group", { name: "Answer" })).toBeNull();
});

test("Why did this fail? says why when golem cannot answer, and a run that did not fail does not offer it", async () => {
  const user = userEvent.setup();
  const { unmount } = view(SAMPLE_RUN_FAILED, { onAsk: vi.fn(async () => Promise.reject(new Error("no model for this folder"))) });
  await user.click(screen.getByRole("button", { name: "Why did this fail?" }));
  expect(await screen.findByText("no model for this folder")).toBeTruthy();
  unmount();
  view(SAMPLE_RUN_DONE, { onAsk: vi.fn(async () => "") });
  expect(screen.queryByRole("button", { name: "Why did this fail?" })).toBeNull();
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
  for (const sample of [SAMPLE_RUN_RUNNING, SAMPLE_RUN_REVIEW, SAMPLE_RUN_TOOL_ASK, SAMPLE_RUN_FAILED, SAMPLE_RUN_CANCELLED, SAMPLE_RUN_DONE, SAMPLE_RUN_TEXT, SAMPLE_RUN_FILE, SAMPLE_RUN_OUTPUTS, SAMPLE_RUN_LOOP]) {
    const { container, unmount } = view(sample, { onReadOutput: async () => SAMPLE_FILE_READ });
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
    fake.emitWorkflow({ kind: "run", method: "workflow.run.done", params: { ...SAMPLE_RUN_DONE.run, workflow_run_id: "wr_1" } as never });
  });
  await waitFor(() => expect(fake.raw.workflowStatus.mock.calls.length).toBeGreaterThan(before));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Review, Send this digest?" })).toBeNull());
  expect(within(screen.getByRole("heading", { level: 1 })).getByText("done")).toBeTruthy();
});

test("/runs/:id asks golem about a failed run through the workflow's own ask, with the file's text", async () => {
  const fake = mount("/runs/wr_1", (one) => {
    one.raw.workflowStatus.mockResolvedValue({ ...SAMPLE_RUN_FAILED, run: { ...SAMPLE_RUN_FAILED.run, workflow_run_id: "wr_1" } });
    one.raw.getWorkflow.mockResolvedValue({ workflow: { id: SAMPLE_RUN_FAILED.run.workflow_id }, steps: [], code: "print(1)", code_hash: "h" } as never);
    one.raw.proposeWorkflow.mockResolvedValue({ code: "print(1)", note: "", answer: "Sign in again.", kind: "answer", model: "m" } as never);
  });
  fireEvent.click(await screen.findByRole("button", { name: "Why did this fail?" }));
  expect(await screen.findByText("Sign in again.")).toBeTruthy();
  expect(fake.raw.proposeWorkflow).toHaveBeenCalledWith(SAMPLE_RUN_FAILED.run.workflow_id, "print(1)", expect.stringContaining("Why did this fail?"), undefined);
});

test("/runs/:id says so when the run does not exist", async () => {
  mount("/runs/nope", (fake) => fake.raw.workflowStatus.mockRejectedValue(new Error("no workflow run nope")));
  expect(await screen.findByText("no workflow run nope")).toBeTruthy();
});

test("a run that stopped at a model step offers Resume with another model, and the pick is sent", async () => {
  const user = userEvent.setup();
  const sample: WorkflowRunSample = { ...SAMPLE_RUN_FAILED, steps: SAMPLE_RUN_FAILED.steps.map((step) => ({ ...step, kind: "llm", title: "Write the briefing" })) };
  const { props } = view(sample, { models: ["qwen3.5:9b", "deepseek/chat"] });
  await user.click(screen.getAllByRole("button", { name: "Resume with another model…" })[0] as HTMLElement);
  await user.click(screen.getByRole("button", { name: "deepseek/chat" }));
  await waitFor(() => expect(props.onResume).toHaveBeenCalledWith("deepseek/chat"));
});

test("a run that stopped at a tool step does not offer another model", () => {
  view(SAMPLE_RUN_FAILED, { models: ["qwen3.5:9b"] });
  expect(screen.queryByRole("button", { name: "Resume with another model…" })).toBeNull();
});

test("/runs/:id folds the run's events into the page and reads nothing again", async () => {
  const fake = mount("/runs/wr_live", (one) => {
    one.raw.workflowStatus.mockResolvedValue({ run: { ...SAMPLE_RUN_RUNNING.run, workflow_run_id: "wr_live" }, steps: SAMPLE_RUN_RUNNING.steps, reviews: [] });
  });
  expect(await screen.findByText("2 of 5 steps")).toBeTruthy();
  const reads = fake.raw.workflowStatus.mock.calls.length;
  const reviewer = SAMPLE_RUN_RUNNING.steps[2]!;
  act(() => {
    fake.emitWorkflow({ kind: "step", method: "workflow.step.done", params: { ...reviewer, workflow_run_id: "wr_live", status: "done", finished_at: reviewer.started_at, line: "3 files checked", result_size: 0 } as never });
  });
  expect(await screen.findByText("3 of 5 steps")).toBeTruthy();
  expect(screen.getByText("3 files checked")).toBeTruthy();
  // The next step starts, and the daemon says it now expects six.
  act(() => {
    fake.emitWorkflow({ kind: "step", method: "workflow.step.started", params: { key: "write", kind: "llm", title: "Writing the briefing", status: "running", attempts: 1, started_at: reviewer.started_at, workflow_run_id: "wr_live", result_size: 0 } as never });
    fake.emitWorkflow({ kind: "run", method: "workflow.run.updated", params: { ...SAMPLE_RUN_RUNNING.run, workflow_run_id: "wr_live", steps_expected: 6 } as never });
  });
  expect(await screen.findByText("3 of 6 steps")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Working now" })).getByText("Writing the briefing")).toBeTruthy();
  // An output as it is marked, then the end of the run with its result.
  act(() => {
    fake.emitWorkflow({ kind: "output", method: "workflow.output.added", params: { workflow_run_id: "wr_live", position: 0, title: "Briefing", summary: "Three things need you", value: "Read the mail first.", size: 20 } as never });
    fake.emitWorkflow({ kind: "run", method: "workflow.run.done", params: { ...SAMPLE_RUN_RUNNING.run, workflow_run_id: "wr_live", status: "done", finished_at: reviewer.started_at, steps_expected: null, result: null, result_size: 0 } as never });
  });
  await waitFor(() => expect(within(screen.getByRole("heading", { level: 1 })).getByText("done")).toBeTruthy());
  expect(screen.getAllByText("Three things need you").length).toBeGreaterThan(0);
  expect(fake.raw.workflowStatus.mock.calls.length).toBe(reads);
});

test("/runs/:id reads the run again when an event left out a large result", async () => {
  const fake = mount("/runs/wr_live", (one) => {
    one.raw.workflowStatus.mockResolvedValue({ run: { ...SAMPLE_RUN_RUNNING.run, workflow_run_id: "wr_live" }, steps: SAMPLE_RUN_RUNNING.steps, reviews: [] });
  });
  expect(await screen.findByText("2 of 5 steps")).toBeTruthy();
  const reads = fake.raw.workflowStatus.mock.calls.length;
  const reviewer = SAMPLE_RUN_RUNNING.steps[2]!;
  act(() => {
    fake.emitWorkflow({ kind: "step", method: "workflow.step.done", params: { ...reviewer, workflow_run_id: "wr_live", status: "done", result: null, line: "6000 characters of notes\u2026", result_size: 6000 } as never });
  });
  await waitFor(() => expect(fake.raw.workflowStatus.mock.calls.length).toBeGreaterThan(reads));
});

test("a model step that is writing shows what was found so far, then its text, and the usual time in the header", () => {
  view(SAMPLE_RUN_STREAMING);
  const live = within(screen.getByRole("group", { name: "Live" }));
  expect(live.getByText("2 projects changed")).toBeTruthy();
  expect(live.getByText("1 error in app.log")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Writing the briefing, as it comes" }).textContent).toContain("3 pull requests wait on you");
  expect(screen.getByText(/usually about 45s/)).toBeTruthy();
});

test("a run whose steps send no text keeps the page it had, and says nothing of a usual time it does not have", () => {
  view(SAMPLE_RUN_RUNNING);
  expect(screen.queryByRole("group", { name: "Live" })).toBeNull();
  expect(screen.getByRole("group", { name: "What it did" })).toBeTruthy();
  expect(screen.queryByText(/usually about/)).toBeNull();
});

test("/runs/:id shows the text of a step as it comes from events, and a page opened midway has the text so far", async () => {
  const fake = mount("/runs/wr_live", (one) => {
    one.raw.workflowStatus.mockResolvedValue({ run: { ...SAMPLE_RUN_STREAMING.run, workflow_run_id: "wr_live" }, steps: SAMPLE_RUN_STREAMING.steps, reviews: [] });
  });
  // Opened midway: the status carries the text so far.
  expect(await screen.findByText(/3 pull requests wait on you/)).toBeTruthy();
  const reads = fake.raw.workflowStatus.mock.calls.length;
  act(() => {
    fake.emitWorkflow({ kind: "progress", method: "workflow.step.progress", params: { workflow_run_id: "wr_live", key: "write", text: "Good morning. Two projects changed overnight. Read the mail first.", done: false } as never });
  });
  expect(await screen.findByText(/Read the mail first/)).toBeTruthy();
  // The step ends: its text goes, and the run is not read again for any of it.
  act(() => {
    fake.emitWorkflow({ kind: "progress", method: "workflow.step.progress", params: { workflow_run_id: "wr_live", key: "write", text: "Good morning.", done: true } as never });
    fake.emitWorkflow({ kind: "step", method: "workflow.step.done", params: { key: "write", kind: "llm", title: "Writing the briefing", status: "done", attempts: 1, workflow_run_id: "wr_live", result: "Good morning.", result_size: 15, line: "Good morning." } as never });
  });
  await waitFor(() => expect(screen.queryByRole("group", { name: "Live" })).toBeNull());
  expect(fake.raw.workflowStatus.mock.calls.length).toBe(reads);
});
