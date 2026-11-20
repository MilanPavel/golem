import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runBannerText, runDuration, runGroupHeading, runGroups, runResultLine, runRowLine } from "@golem/view";
import { App } from "../../app.tsx";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import type { RunInfo } from "../../store/runs.ts";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { sidebarItemStore } from "../sidebar/sidebar-item.ts";
import { cloudFinishedChat, localRunningChat, STEPS_NOW } from "../workbench/steps-sample.ts";
import { stepsBatches } from "../workbench/index.ts";
import { LeadRun } from "./lead-run.tsx";
import { RunBanner } from "./run-banner.tsx";
import { RunsList } from "./runs-list.tsx";
import { RunsPanel } from "./runs-panel.tsx";
import { RUNS_NOW, SAMPLE_RUN_LIST, SAMPLE_WAITING_RUN } from "./sample.ts";

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

function mount(path: string, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
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

test("the list groups runs as Needs you, Running, Today and Earlier, and a waiting run is under Needs you", async () => {
  const onNavigate = vi.fn();
  const { container } = render(<RunsList runs={SAMPLE_RUN_LIST} now={RUNS_NOW} onNavigate={onNavigate} />);
  // The groups, their headings and their order come from the shared words.
  const groups = runGroups(SAMPLE_RUN_LIST, RUNS_NOW);
  expect(groups.map((group) => group.label)).toEqual(["Needs you", "Running", "Today", "Earlier"]);
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings).toEqual(groups.map(runGroupHeading));
  const needs = within(screen.getByRole("region", { name: runGroupHeading(groups[0]!) }));
  const waiting = needs.getByRole("link", { name: /sentry-triage/ });
  expect(waiting.textContent).toContain(runRowLine(SAMPLE_WAITING_RUN, RUNS_NOW));
  expect(waiting.textContent).toContain(runResultLine(SAMPLE_WAITING_RUN));
  expect(waiting.textContent).toContain(runDuration(SAMPLE_WAITING_RUN, RUNS_NOW));
  // A routine and a detached ask are both rows, and a failed run says why.
  expect(screen.getAllByText("golem ask")).toHaveLength(1);
  expect(screen.getByText("provider timeout")).toBeTruthy();
  await userEvent.setup().click(waiting);
  expect(onNavigate).toHaveBeenCalledWith("/s/s_wait");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the list says it is loading, failed, or empty", () => {
  const { rerender } = render(<RunsList runs={null} now={RUNS_NOW} onNavigate={() => {}} />);
  expect(screen.getByText("Loading runs.")).toBeTruthy();
  rerender(<RunsList runs={null} error="down" now={RUNS_NOW} onNavigate={() => {}} />);
  expect(screen.getByText("Could not load runs. down")).toBeTruthy();
  rerender(<RunsList runs={[]} now={RUNS_NOW} onNavigate={() => {}} />);
  expect(screen.getByText(/Nothing has run yet/)).toBeTruthy();
});

test("the panel shows the same groups in one line a run, with the open run marked", async () => {
  const onNavigate = vi.fn();
  const { container } = render(<RunsPanel runs={SAMPLE_RUN_LIST} selected="s_wait" now={RUNS_NOW} onNavigate={onNavigate} />);
  expect(screen.getByRole("list", { name: "Needs you" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /sentry-triage.*Allow/ }).getAttribute("aria-current")).toBe("page");
  await userEvent.setup().click(screen.getByRole("link", { name: "Open Runs" }));
  expect(onNavigate).toHaveBeenCalledWith("/runs");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the banner says the routine, when, why, and what waits, for each trigger, with links", async () => {
  const onNavigate = vi.fn();
  const kinds: [RunInfo, string][] = [
    [SAMPLE_WAITING_RUN, "by schedule"],
    [{ ...SAMPLE_WAITING_RUN, status: "running", approvals: 0, trigger: "manual" }, "by you"],
    [{ ...SAMPLE_WAITING_RUN, status: "succeeded", approvals: 0, trigger: "watch", watch_path: "/Users/you/Downloads/receipt-0412.pdf" }, "by new file receipt-0412.pdf"],
  ];
  for (const [run, how] of kinds) {
    const { container, unmount } = render(<RunBanner run={run} now={RUNS_NOW} onNavigate={onNavigate} />);
    const region = screen.getByRole("region", { name: "Routine run" });
    expect(region.textContent).toContain(`Routine ${run.routine}`);
    // The line is the shared words, with the approvals part in its own tone.
    expect(region.textContent).toContain(runBannerText({ ...run, approvals: 0 }, RUNS_NOW));
    expect(region.textContent).toContain(how);
    expect(region.textContent?.includes("1 approval waiting")).toBe(run.approvals === 1);
    expect(within(region).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/routines/sentry-triage", "/runs"]);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    unmount();
  }
  render(<RunBanner run={{ ...SAMPLE_WAITING_RUN, folder: "/Users/you/repos/site" }} now={RUNS_NOW} onNavigate={onNavigate} />);
  await userEvent.setup().click(screen.getByRole("link", { name: "Routine settings" }));
  expect(onNavigate).toHaveBeenCalledWith("/routines/sentry-triage?folder=%2FUsers%2Fyou%2Frepos%2Fsite");
});

test("the banner of a detached ask has no routine link", () => {
  const ask: RunInfo = { session_id: "s_ask", kind: "ask", origin: "cli", status: "running", started_at: SAMPLE_WAITING_RUN.started_at, approvals: 0 };
  render(<RunBanner run={ask} now={RUNS_NOW} onNavigate={() => {}} />);
  expect(screen.getByRole("region", { name: "Routine run" }).textContent).toContain("golem ask");
  expect(screen.queryByRole("link", { name: "Routine settings" })).toBeNull();
  expect(screen.getByRole("link", { name: "All runs" }).getAttribute("href")).toBe("/runs");
});

test("/runs loads run.list and groups the rows; a click opens the session", async () => {
  const user = userEvent.setup();
  const fake = mount("/runs", ({ raw }) => {
    raw.listRuns.mockResolvedValue({ runs: SAMPLE_RUN_LIST });
  });
  expect(await screen.findByRole("heading", { name: "Runs", level: 1 })).toBeTruthy();
  const needs = await screen.findByRole("region", { name: /^Needs you \(1\)$/ });
  expect(fake.raw.listRuns).toHaveBeenCalledWith();
  expect(screen.getByText(/1 needs you · 7 runs/)).toBeTruthy();
  await user.click(within(needs).getByRole("link", { name: /sentry-triage/ }));
  expect(location.pathname).toBe("/s/s_wait");
});

test("the Runs rail item shows the panel, and a routine that fires reloads it", async () => {
  sidebarItemStore.set("runs");
  const fake = mount("/", ({ raw }) => {
    raw.listRuns.mockResolvedValue({ runs: SAMPLE_RUN_LIST });
  });
  const panel = await screen.findByRole("complementary", { name: "Runs" });
  expect(await within(panel).findByRole("link", { name: /sentry-triage.*Allow/ })).toBeTruthy();
  const calls = fake.raw.listRuns.mock.calls.length;
  fake.emitRoutines("fired");
  await waitFor(() => expect(fake.raw.listRuns.mock.calls.length).toBeGreaterThan(calls));
});

test("a headless session that changes marks the runs stale, and a chat of yours does not", async () => {
  const fake = mount("/runs", ({ raw }) => {
    raw.listRuns.mockResolvedValue({ runs: SAMPLE_RUN_LIST });
  });
  await screen.findByRole("region", { name: /^Needs you/ });
  const calls = fake.raw.listRuns.mock.calls.length;
  act(() => {
    fake.emitSummary({ ...summary("s_mine", "2026-11-17T10:00:00Z"), origin: "user" });
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  expect(fake.raw.listRuns.mock.calls.length).toBe(calls);
  act(() => {
    fake.emitSummary({ ...summary("s_wait", "2026-11-17T10:00:00Z"), origin: "routine:sentry-triage", status: "waiting" });
  });
  await waitFor(() => expect(fake.raw.listRuns.mock.calls.length).toBeGreaterThan(calls));
});

test("a waiting routine run opens with its banner and the docked approval", async () => {
  const fake = mount("/s/s_wait", ({ raw }) => {
    raw.listRuns.mockImplementation(async (options) => ({ runs: options?.sessionId === "s_wait" ? [SAMPLE_WAITING_RUN] : SAMPLE_RUN_LIST }));
  });
  act(() => {
    fake.emitSummary({ ...summary("s_wait", "2026-11-17T17:25:00Z", "/Users/you/repos/golem"), origin: "routine:sentry-triage", status: "waiting", title: "sentry-triage" });
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  const send = (type: Parameters<typeof ev>[1], data: Record<string, unknown>) => {
    act(() => {
      fake.emitEvent(ev("s_wait", type, data));
    });
  };
  send("session.created", { cwd: "/Users/you/repos/golem", model_profile: "local", model_name: "m" });
  send("run.started", {});
  send("message.started", { message_id: "m1", role: "assistant" });
  send("message.completed", { message_id: "m1", role: "assistant", text: "" });
  send("tool.requested", { call_id: "c1", message_id: "m1", name: "mcp__linear__create_issue", args: { team: "GOL" } });
  send("approval.needed", { call_id: "c1", name: "mcp__linear__create_issue", args: { team: "GOL" }, source: "your rules", subject: "TypeError in router" });
  const banner = await screen.findByRole("region", { name: "Routine run" });
  expect(banner.textContent).toContain("Routine sentry-triage");
  expect(banner.textContent).toContain("1 approval waiting");
  expect(fake.raw.listRuns).toHaveBeenCalledWith({ sessionId: "s_wait" });
  expect(await screen.findByRole("group", { name: "Approval" })).toBeTruthy();
});

test("a chat of yours has no banner", async () => {
  mount("/s/s_mine", ({ raw }) => {
    raw.listRuns.mockResolvedValue({ runs: [] });
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  expect(screen.queryByRole("region", { name: "Routine run" })).toBeNull();
});

test("a lead's row says how many helpers work, over the full-width step list that opens a helper", () => {
  const { container } = render(
    <LeadRun title="Fix the login redirect" model="Qwen3 Coder" running={2} waiting={1} batches={stepsBatches(localRunningChat(), STEPS_NOW)} href="/s/lead" onNavigate={() => {}} />,
  );
  const region = screen.getByRole("region", { name: "Helpers of Fix the login redirect" });
  expect(within(region).getByText("2 helpers working, 1 helper asks you")).toBeTruthy();
  expect(within(region).getByText("Qwen3 Coder")).toBeTruthy();
  expect(within(region).getByRole("link", { name: "Fix the login redirect" }).getAttribute("href")).toBe("/s/lead");
  expect(container.querySelectorAll("[data-step-row]").length).toBeGreaterThan(0);
});

test("a lead with nothing working says so", () => {
  render(<LeadRun title="Map the auth code" running={0} waiting={null} batches={stepsBatches(cloudFinishedChat(), STEPS_NOW)} href="/s/lead" onNavigate={() => {}} />);
  expect(screen.getByText("no helpers working")).toBeTruthy();
});

test("a step row in Runs opens its helper and goes to the lead's chat", () => {
  const went: string[] = [];
  render(
    <LeadRun title="Fix the login redirect" running={2} waiting={0} batches={stepsBatches(localRunningChat(), STEPS_NOW)} href="/s/lead" leadId="lead" onNavigate={(path) => went.push(path)} />,
  );
  const row = screen.getAllByRole("button", { name: /^Open / })[0];
  if (row === undefined) throw new Error("no helper row");
  fireEvent.click(row);
  expect(went).toEqual(["/s/lead"]);
});

