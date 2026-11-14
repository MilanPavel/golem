import { act, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { createPageHost } from "../../store/page-host.ts";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { RESTART_GRACE_MS } from "./connection-screen.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

async function mountDown(kept: boolean | undefined) {
  const fake = fakeClient();
  fake.raw.setupStatus.mockResolvedValue({ rows: [] });
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const pageHost = createPageHost(async () => (kept === undefined ? {} : { kept }));
  const page = createPage(fake.client, { frame: fakeFrame(), doc, pageHost });
  page.start();
  await act(async () => {
    await pageHost.refresh();
  });
  fake.setState({ status: "reconnecting", attempt: 1, delayMs: 1000, closeCode: 1006 });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page };
}

test("a kept gateway that goes away: restarting, reconnects by itself, no command", async () => {
  await mountDown(true);
  expect(screen.getByRole("heading", { name: "golem's page server is restarting" })).toBeTruthy();
  expect(screen.getByText("It comes back by itself, usually within a few seconds. This page reconnects when it does.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
});

test("after 30 seconds without it: today's screen, with golem and the web log command", async () => {
  await mountDown(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESTART_GRACE_MS + 10);
  });
  expect(screen.getByRole("heading", { name: "The golem page is not running" })).toBeTruthy();
  expect(screen.getByText("golem")).toBeTruthy();
  expect(screen.getByText("tail ~/.golem/logs/web.stderr.log")).toBeTruthy();
});

test("without a job: today's screen, with golem install and why", async () => {
  await mountDown(false);
  expect(screen.getByRole("heading", { name: "The golem page is not running" })).toBeTruthy();
  expect(screen.getByText("Keeps golem and this page running, even after a restart.")).toBeTruthy();
  expect(screen.getByText("golem install")).toBeTruthy();
});

test("with the job unknown: today's screen alone", async () => {
  await mountDown(undefined);
  expect(screen.getByRole("heading", { name: "The golem page is not running" })).toBeTruthy();
  expect(screen.queryByText("golem install")).toBeNull();
  expect(screen.queryByText("tail ~/.golem/logs/web.stderr.log")).toBeNull();
});

test("a gateway that comes back clears the screen", async () => {
  const { fake } = await mountDown(true);
  act(() => fake.setState({ status: "connected" }));
  expect(screen.queryByRole("heading", { name: "golem's page server is restarting" })).toBeNull();
});

test.each([
  ["slip", true],
  ["slip", false],
  ["kiln", true],
  ["kiln", false],
] as const)("the gateway-down screen has no axe violations in %s, kept %s", async (theme, kept) => {
  document.documentElement.dataset.theme = theme;
  await mountDown(kept);
  expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
});
