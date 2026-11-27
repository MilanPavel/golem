import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { RunsList } from "./runs-list.tsx";
import { RunPane, RunsView } from "./runs-screen.tsx";
import { RUNS_NOW, SAMPLE_FILTER_RUNS, SAMPLE_FILTER_WORKFLOW, SAMPLE_MIXED_RUNS } from "./sample.ts";
import { SAMPLE_FILE_READ, SAMPLE_RUN_DONE, SAMPLE_RUN_FAILED, SAMPLE_RUN_FILE, SAMPLE_RUN_RUNNING, SAMPLE_RUN_TEXT, type WorkflowRunSample } from "./workflow-sample.ts";

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

const SAMPLES: Record<string, WorkflowRunSample> = { wr_today: SAMPLE_RUN_TEXT, wr_empty: SAMPLE_RUN_DONE, wr_fail: SAMPLE_RUN_FAILED, wr_run: SAMPLE_RUN_RUNNING, wr_old: SAMPLE_RUN_FILE };

function mount(path: string) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listRuns.mockResolvedValue({ runs: SAMPLE_MIXED_RUNS });
  fake.raw.workflowStatus.mockImplementation(async (id: string) => {
    const sample = SAMPLES[id] ?? SAMPLE_RUN_DONE;
    return { run: { ...sample.run, workflow_run_id: id }, steps: sample.steps, reviews: sample.reviews };
  });
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

const WORKFLOW_URL = `/runs?workflow=${encodeURIComponent(SAMPLE_FILTER_WORKFLOW)}`;

test("a workflow run says what came out in one line under its name, by kind, with its state, start and time", () => {
  render(<RunsList runs={SAMPLE_FILTER_RUNS} now={RUNS_NOW} onNavigate={() => {}} />);
  const row = (key: string) => within(screen.getAllByRole("link").find((link) => link.getAttribute("href") === `/runs/${key}`)!);
  // A result in a line, nothing found, a failure's reason, and a run that goes says no result yet.
  expect(row("wr_today").getByText("3 things need you")).toBeTruthy();
  expect(row("wr_empty").getByText("Nothing found")).toBeTruthy();
  expect(row("wr_fail").getByText("tool mcp__github__list_pull_requests: needs sign-in").className).toContain("text-deny");
  expect(row("wr_old").getByText("Saved as 2026-11-16.md")).toBeTruthy();
  expect(row("wr_today").getByText(/1m 12s/)).toBeTruthy();
  expect(row("wr_run").getByText("3 steps")).toBeTruthy();
  expect(row("wr_run").getAllByText("running").length).toBeGreaterThan(0);
});

test("the filter chip shows the workflow, and clearing it shows every run", async () => {
  const onNavigate = vi.fn();
  const renderResult = () => null;
  const { rerender } = render(<RunsView runs={SAMPLE_MIXED_RUNS} now={RUNS_NOW} workflow={SAMPLE_FILTER_WORKFLOW} onNavigate={onNavigate} renderResult={renderResult} />);
  expect(screen.getByText("Workflow: pr_digest")).toBeTruthy();
  // Only its runs are listed.
  expect(screen.queryByText("sentry-triage")).toBeNull();
  expect(screen.getAllByText("pr_digest")).toHaveLength(SAMPLE_FILTER_RUNS.length);
  expect(screen.getByRole("link", { name: "Open the workflow" }).getAttribute("href")).toBe(`/workflows/${encodeURIComponent(SAMPLE_FILTER_WORKFLOW)}`);
  await userEvent.setup().click(screen.getByRole("link", { name: "Workflow: pr_digest. Show every run" }));
  expect(onNavigate).toHaveBeenCalledWith("/runs");
  rerender(<RunsView runs={SAMPLE_MIXED_RUNS} now={RUNS_NOW} onNavigate={onNavigate} renderResult={renderResult} />);
  expect(screen.queryByText("Workflow: pr_digest")).toBeNull();
  expect(screen.getAllByText("sentry-triage").length).toBeGreaterThan(0);
});

test("the chip says the workflow's title when it is known", () => {
  render(<RunsView runs={SAMPLE_MIXED_RUNS} now={RUNS_NOW} workflow={SAMPLE_FILTER_WORKFLOW} workflowTitle="PR digest" onNavigate={() => {}} renderResult={() => null} />);
  expect(screen.getByText("Workflow: PR digest")).toBeTruthy();
});

test("a filter that matches no run says so", () => {
  render(<RunsView runs={SAMPLE_RUN_LIST_ONLY_OTHERS()} now={RUNS_NOW} workflow={SAMPLE_FILTER_WORKFLOW} onNavigate={() => {}} renderResult={() => null} />);
  expect(screen.getByText("pr_digest has not run yet.")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Show every run/ })).toBeTruthy();
});

function SAMPLE_RUN_LIST_ONLY_OTHERS() {
  return SAMPLE_MIXED_RUNS.filter((run) => run.workflow_run_id == null);
}

test("/runs?workflow= reads the filter from the URL, and the chip clears it in the URL", async () => {
  const user = userEvent.setup();
  mount(WORKFLOW_URL);
  const chip = await screen.findByRole("link", { name: "Workflow: pr_digest. Show every run" });
  expect(screen.queryByText("sentry-triage")).toBeNull();
  await user.click(chip);
  expect(location.pathname).toBe("/runs");
  expect(location.search).toBe("");
  expect((await screen.findAllByText("sentry-triage")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: /Show every run/ })).toBeNull();
});

test("the first workflow run's result opens beside the list, and a click picks another without leaving the page", async () => {
  const user = userEvent.setup();
  const fake = mount(WORKFLOW_URL);
  // The run that goes comes first in the list, so it is the one open.
  await screen.findByRole("group", { name: "Result of PR digest" });
  expect(fake.raw.workflowStatus).toHaveBeenCalledWith("wr_run");
  const today = screen.getAllByRole("link").find((link) => link.getAttribute("href") === "/runs/wr_today")!;
  await user.click(today);
  expect(location.pathname).toBe("/runs");
  expect(await screen.findByRole("group", { name: "Result of Morning briefing" })).toBeTruthy();
  expect(today.getAttribute("aria-current")).toBe("true");
  const pane = within(screen.getByRole("group", { name: "Result of Morning briefing" }));
  expect(pane.getByRole("link", { name: "See how this run went, step by step" }).getAttribute("href")).toBe("/runs/wr_today");
  await user.click(pane.getByRole("link", { name: "See how this run went, step by step" }));
  expect(location.pathname).toBe("/runs/wr_today");
});

test("the arrow keys move through the workflow runs, and stop at the ends", async () => {
  mount(WORKFLOW_URL);
  await screen.findByRole("group", { name: "Result of PR digest" });
  const selected = () => screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "true").map((link) => link.getAttribute("href"));
  expect(selected()).toEqual(["/runs/wr_run"]);
  // Order on the page: running, then today (newest first), then earlier.
  const order = ["/runs/wr_today", "/runs/wr_empty", "/runs/wr_fail", "/runs/wr_old", "/runs/wr_old"];
  for (const href of order) {
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => expect(selected()).toEqual([href]));
  }
  fireEvent.keyDown(window, { key: "ArrowUp" });
  await waitFor(() => expect(selected()).toEqual(["/runs/wr_fail"]));
  // A key meant for a field is left to it.
  const field = document.createElement("input");
  document.body.append(field);
  fireEvent.keyDown(field, { key: "ArrowUp" });
  expect(selected()).toEqual(["/runs/wr_fail"]);
  field.remove();
});

test("the result pane shows the failure where a run stopped, the result of one that finished, and what it did for one with none", async () => {
  const pane = (sample: WorkflowRunSample) =>
    render(<RunPane run={sample.run} steps={sample.steps} onReadOutput={() => Promise.resolve(SAMPLE_FILE_READ)} onNavigate={() => {}} />);
  const failed = pane(SAMPLE_RUN_FAILED);
  expect(screen.getByRole("group", { name: "Why it stopped" }).textContent).toContain("needs sign-in");
  expect((await axe.run(failed.container, noContrast)).violations).toEqual([]);
  failed.unmount();
  const text = pane(SAMPLE_RUN_TEXT);
  expect(screen.getByRole("group", { name: "Result: Morning briefing" })).toBeTruthy();
  text.unmount();
  pane(SAMPLE_RUN_DONE);
  expect(screen.getByRole("group", { name: "What it did" })).toBeTruthy();
});
