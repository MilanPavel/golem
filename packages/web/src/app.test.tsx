import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app.tsx";
import { RESTART_GRACE_MS } from "./features/connection/index.ts";
import type { ConnectionSnapshot } from "./store/connection.ts";
import { ConnectionProvider } from "./store/connection-context.tsx";
import { createPage } from "./store/page.ts";
import { PageProvider } from "./store/page-context.tsx";
import { fakeClient, fakeFrame } from "./store/test-support.ts";

function renderApp(snapshot: ConnectionSnapshot) {
  const source = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  // The inner provider decides what the test's link looks like; the page supplies the rest.
  return render(
    <PageProvider page={page}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
}

const noContrast = {
  // jsdom does not compute colors, so contrast cannot be checked here.
  rules: { "color-contrast": { enabled: false } },
};

const CASES: [string, ConnectionSnapshot, string, string | null][] = [
  ["connecting", { state: { status: "connecting" }, daemonVersion: null }, "Connecting to golem", null],
  ["unauthorized", { state: { status: "unauthorized" }, daemonVersion: null }, "This page needs a fresh link", "golem"],
  [
    "rejected",
    { state: { status: "rejected", reason: "protocol major mismatch: client 2, daemon 1" }, daemonVersion: null },
    "The daemon is older than this page",
    "golem daemon restart",
  ],
  [
    "daemon down",
    { state: { status: "reconnecting", attempt: 4, delayMs: 1000, closeCode: 1013 }, daemonVersion: null },
    "golem's daemon is not running",
    "golem daemon start",
  ],
  [
    "gateway down",
    { state: { status: "reconnecting", attempt: 1, delayMs: 1000 }, daemonVersion: null },
    "The golem page is not running",
    "golem",
  ],
  ["closed", { state: { status: "closed", reason: "closed" }, daemonVersion: null }, "The golem page is not running", "golem"],
];

afterEach(() => vi.restoreAllMocks());

test.each(CASES)("%s: the heading, the command, and no accessibility violations", async (_name, snapshot, heading, command) => {
  const { container } = renderApp(snapshot);
  expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
  if (command === null) {
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  } else {
    expect(container.querySelector("code")?.textContent).toBe(command);
  }
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the copy button writes the command and shows Copied", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  renderApp(CASES[1]![1]);
  await user.click(screen.getByRole("button", { name: "Copy command" }));
  expect(writeText).toHaveBeenCalledWith("golem");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});

test("connected shows the page, the rail with the golem's version, and no strip", async () => {
  const { container } = renderApp({ state: { status: "connected" }, daemonVersion: "0.9.1" });
  expect(screen.getByRole("heading", { name: "Start a new session" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "golem v0.9.1 · connected" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("connected without a version names the golem without one", () => {
  renderApp({ state: { status: "connected" }, daemonVersion: null });
  expect(screen.getByRole("img", { name: "golem · connected" })).toBeTruthy();
  expect(screen.queryByText(/golem v/)).toBeNull();
});

test("a lost link after a connect keeps the page and shows the strip; the first connect does not", () => {
  let snapshot: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };
  const listeners = new Set<() => void>();
  const source = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
  const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  render(
    <PageProvider page={page}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
  expect(screen.queryByText("Reconnecting to golem…")).toBeNull();
  act(() => {
    snapshot = { state: { status: "reconnecting", attempt: 1, delayMs: 1000 }, daemonVersion: "0.9.1" };
    for (const listener of listeners) listener();
  });
  expect(screen.getByText("Reconnecting to golem…")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Start a new session" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "golem v0.9.1 · reconnecting" })).toBeTruthy();
  expect(screen.getByTestId("settings-dot")).toBeTruthy();
  act(() => {
    snapshot = { state: { status: "closed", reason: "closed" }, daemonVersion: "0.9.1" };
    for (const listener of listeners) listener();
  });
  expect(screen.getByRole("heading", { level: 1, name: "The golem page is not running" })).toBeTruthy();
});

test("the strip turns into the connection screen once the link has been gone for the grace", () => {
  vi.useFakeTimers();
  try {
    let snapshot: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };
    const listeners = new Set<() => void>();
    const source = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
    };
    const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
    render(
      <PageProvider page={page}>
        <ConnectionProvider source={source}>
          <App />
        </ConnectionProvider>
      </PageProvider>,
    );
    act(() => {
      snapshot = { state: { status: "reconnecting", attempt: 1, delayMs: 1000, closeCode: 1013 }, daemonVersion: "0.9.1" };
      for (const listener of listeners) listener();
    });
    expect(screen.getByText("Reconnecting to golem…")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(RESTART_GRACE_MS - 1);
    });
    expect(screen.getByText("Reconnecting to golem…")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Reconnecting to golem…")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "golem's daemon is not running" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("the Settings page shows the daemon version at the foot of its sidebar", () => {
  history.replaceState(null, "", "/settings");
  try {
    renderApp({ state: { status: "connected" }, daemonVersion: "0.9.1" });
    const sidebar = screen.getByTestId("settings-nav");
    expect(sidebar.textContent).toContain("golem v0.9.1");
  } finally {
    history.replaceState(null, "", "/");
  }
});

test("on the welcome page a lost link takes the whole screen at once, as it has no panel for the strip", () => {
  history.replaceState(null, "", "/welcome");
  try {
    let snapshot: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };
    const listeners = new Set<() => void>();
    const source = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
    };
    const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
    render(
      <PageProvider page={page}>
        <ConnectionProvider source={source}>
          <App />
        </ConnectionProvider>
      </PageProvider>,
    );
    act(() => {
      snapshot = { state: { status: "reconnecting", attempt: 1, delayMs: 1000 }, daemonVersion: "0.9.1" };
      for (const listener of listeners) listener();
    });
    expect(screen.getByRole("heading", { level: 1, name: "The golem page is not running" })).toBeTruthy();
  } finally {
    history.replaceState(null, "", "/");
  }
});
