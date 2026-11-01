import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app.tsx";
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
  ["unauthorized", { state: { status: "unauthorized" }, daemonVersion: null }, "This page needs a fresh link", "golem web"],
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
    "golem web is not running",
    "golem web",
  ],
  ["closed", { state: { status: "closed", reason: "closed" }, daemonVersion: null }, "golem web is not running", "golem web"],
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
  expect(writeText).toHaveBeenCalledWith("golem web");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});

test("connected shows the page, the connection line, and the version", async () => {
  const { container } = renderApp({ state: { status: "connected" }, daemonVersion: "0.9.1" });
  expect(screen.getByText("golem", { selector: "span" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Start a new session" })).toBeTruthy();
  expect(screen.getByText("connected")).toBeTruthy();
  expect(screen.getByText("golem v0.9.1")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("connected without a version shows only connected", () => {
  renderApp({ state: { status: "connected" }, daemonVersion: null });
  expect(screen.getByText("connected")).toBeTruthy();
  expect(screen.queryByText(/golem v/)).toBeNull();
});
