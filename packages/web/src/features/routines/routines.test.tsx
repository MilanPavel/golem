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
import { RoutineDetail } from "./routine-detail.tsx";
import { RoutinesPanel } from "./routines-panel.tsx";
import { ROUTINES_NOW, SAMPLE_LIST, SAMPLE_MORNING_BRIEF, SAMPLE_RUNS } from "./sample.ts";
import { runWhenText } from "@golem/view";

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

test("the panel lists routines by where they live, with dot, schedule and next run or last result", async () => {
  const onNavigate = vi.fn();
  const { container } = render(<RoutinesPanel list={SAMPLE_LIST} selected={{ name: "morning-brief", folder: null }} now={ROUTINES_NOW} onNavigate={onNavigate} />);
  expect(screen.getByText("Yours")).toBeTruthy();
  expect(screen.getByText("site")).toBeTruthy();
  const brief = screen.getByRole("link", { name: /morning-brief/ });
  expect(brief.getAttribute("aria-current")).toBe("page");
  expect(brief.textContent).toContain("Weekdays at 08:30 · needs you");
  expect(screen.getByRole("link", { name: /sentry-triage/ }).textContent).toContain("Every hour · last run failed");
  expect(screen.getByRole("link", { name: /receipts/ }).textContent).toContain("New *.pdf in ~/Downloads · filed 2 receipts");
  expect(screen.getByRole("link", { name: /dep-report/ }).textContent).toContain("Mondays at 06:00 · off");
  expect(screen.getByRole("link", { name: /release-notes/ }).getAttribute("href")).toBe("/routines/release-notes?folder=%2FUsers%2Fyou%2Frepos%2Fsite");
  expect(screen.getByText("bad-one: schedule is not a time")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("link", { name: /receipts/ }));
  expect(onNavigate).toHaveBeenCalledWith("/routines/receipts");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the panel filters, and says so when there are none", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<RoutinesPanel list={SAMPLE_LIST} selected={null} now={ROUTINES_NOW} onNavigate={() => {}} />);
  await user.type(screen.getByRole("textbox", { name: "Filter routines" }), "zzz");
  expect(screen.getByText("No routines match.")).toBeTruthy();
  rerender(<RoutinesPanel list={{ routines: [] }} selected={null} now={ROUTINES_NOW} onNavigate={() => {}} />);
  expect(screen.getByText(/No routines yet/)).toBeTruthy();
  rerender(<RoutinesPanel list={null} selected={null} now={ROUTINES_NOW} onNavigate={() => {}} />);
  expect(screen.getByText("Loading routines.")).toBeTruthy();
  rerender(<RoutinesPanel list={null} error="down" selected={null} now={ROUTINES_NOW} onNavigate={() => {}} />);
  expect(screen.getByText("Could not load routines.")).toBeTruthy();
});

test("a detail shows the header, what it runs, its History, and the Config as TOML", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <RoutineDetail routine={SAMPLE_MORNING_BRIEF} runs={SAMPLE_RUNS} now={ROUTINES_NOW} onNavigate={() => {}} onRun={() => Promise.resolve({ routine_run_id: "r", session_id: "s" })} />,
  );
  expect(screen.getByRole("heading", { name: /morning-brief/ })).toBeTruthy();
  expect(screen.getByText("Weekdays at 08:30 · next in 14 h")).toBeTruthy();
  expect(screen.getByText("/morning-brief")).toBeTruthy();
  expect(screen.getByText("linear, github")).toBeTruthy();
  const history = within(screen.getByRole("list", { name: "History" }));
  expect(history.getAllByRole("listitem")).toHaveLength(5);
  // The words are local time, so the expected text comes from the same function (CI runs in UTC).
  expect(history.getByText(runWhenText(SAMPLE_RUNS[0]?.started_at, ROUTINES_NOW))).toBeTruthy();
  expect(history.getByText("2m 14s")).toBeTruthy();
  expect(history.getByText("Linear: needs sign-in")).toBeTruthy();
  expect(history.getByText("skipped: paused")).toBeTruthy();
  expect(history.getAllByRole("link", { name: /Open session/ })[0]?.getAttribute("href")).toBe("/s/s_5");
  expect((screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("tab", { name: "Config" }));
  expect(screen.getByLabelText("Config as TOML").textContent).toContain('schedule = "weekdays 08:30"');
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("Run now calls the run and offers the session", async () => {
  const user = userEvent.setup();
  const onRun = vi.fn(() => Promise.resolve({ routine_run_id: "rr_6", session_id: "s_6" }));
  render(<RoutineDetail routine={SAMPLE_MORNING_BRIEF} runs={[]} now={ROUTINES_NOW} onNavigate={() => {}} onRun={onRun} />);
  expect(screen.getByText("No runs yet. Run now starts one.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Run now" }));
  expect(onRun).toHaveBeenCalledOnce();
  expect((await screen.findByRole("link", { name: /Open session/ })).getAttribute("href")).toBe("/s/s_6");
});

test("a refused run shows the reason", async () => {
  const user = userEvent.setup();
  render(<RoutineDetail routine={SAMPLE_MORNING_BRIEF} runs={[]} now={ROUTINES_NOW} onNavigate={() => {}} onRun={() => Promise.reject(new Error("already running"))} />);
  await user.click(screen.getByRole("button", { name: "Run now" }));
  expect((await screen.findByRole("alert")).textContent).toContain("already running");
});

function mount(path: string, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  setup?.(fake);
  const source = { subscribe: () => () => {}, getSnapshot: () => CONNECTED };
  const page = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  // Started, so the pushed notifications mark the answers stale.
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

test("/routines with nothing set up shows the empty state, with starters that wait for the editor", async () => {
  mount("/routines");
  expect(await screen.findByRole("heading", { name: "Nothing runs by itself yet" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Morning brief" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Watch a folder" })).toBeTruthy();
  for (const button of screen.getAllByRole("button", { name: "Use this starter" })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
});

test("/routines/:name loads the routine and its runs, and Run now sends routine.run", async () => {
  const user = userEvent.setup();
  const fake = mount("/routines/morning-brief", ({ raw }) => {
    raw.listRoutines.mockResolvedValue(SAMPLE_LIST);
    raw.getRoutine.mockResolvedValue({ routine: SAMPLE_MORNING_BRIEF, runs: SAMPLE_RUNS });
  });
  expect(await screen.findByRole("list", { name: "History" })).toBeTruthy();
  expect(fake.raw.getRoutine).toHaveBeenCalledWith("morning-brief");
  await user.click(screen.getByRole("button", { name: "Run now" }));
  await waitFor(() => expect(fake.raw.runRoutine).toHaveBeenCalledWith("morning-brief"));
});

test("the Routines rail item shows the panel with the routines, and a pushed change reloads it", async () => {
  const user = userEvent.setup();
  sidebarItemStore.set("routines");
  const fake = mount("/", ({ raw }) => {
    raw.listRoutines.mockResolvedValue(SAMPLE_LIST);
  });
  const panel = await screen.findByRole("complementary", { name: "Routines" });
  await user.click(await within(panel).findByRole("link", { name: /receipts/ }));
  expect(location.pathname).toBe("/routines/receipts");
  const calls = fake.raw.listRoutines.mock.calls.length;
  fake.emitRoutines("fired");
  await waitFor(() => expect(fake.raw.listRoutines.mock.calls.length).toBeGreaterThan(calls));
});
