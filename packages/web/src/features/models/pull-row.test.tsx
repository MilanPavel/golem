import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closeModelDialog } from "./model-dialog-open.ts";
import { SAMPLE_LISTING } from "./sample.ts";

const REF = "ollama/qwen3:14b";
const NAME = "Qwen3 14B";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function mount(path: string) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(SAMPLE_LISTING);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.setupStart.decide();
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: "/Users/you/repos/golem", model_profile: "local", model_name: "qwen3:8b", title: "UTF-8 split" }));
  });
  return { fake, user: userEvent.setup(), ...view };
}

type Fake = Awaited<ReturnType<typeof mount>>["fake"];

function progress(fake: Fake, completed: number, ref = REF) {
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref, status: "pulling", completed, total: 9_300_000_000, progress: completed / 9_300_000_000 } });
  });
}

function done(fake: Fake, ok: boolean, error: string | null = null) {
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: REF, ok, error } });
  });
}

const sidebar = () => screen.getByRole("complementary", { name: "Sessions" });
const row = () => within(sidebar()).queryByRole("button", { name: /^Downloading / });

afterEach(() => {
  closeModelDialog();
  history.replaceState(null, "", "/");
});

test("a download shows in the sidebar on home, in a session and in Settings, and goes when it ends", async () => {
  const { fake, user } = await mount("/");
  expect(row()).toBeNull();
  progress(fake, 1_200_000_000);
  expect(await within(sidebar()).findByRole("button", { name: `Downloading ${NAME}, 12 percent. Open models` })).toBeTruthy();
  await user.click(within(sidebar()).getByRole("link", { name: /UTF-8 split/ }));
  expect(location.pathname).toBe("/s/a");
  expect(row()).not.toBeNull();
  await user.click(within(sidebar()).getByRole("button", { name: /^Settings/ }));
  expect(location.pathname).toBe("/settings");
  expect(row()).not.toBeNull();
  done(fake, true);
  await waitFor(() => expect(row()).toBeNull());
});

test("on home the row opens the model dialog for no session", async () => {
  const { fake, user } = await mount("/");
  progress(fake, 1_200_000_000);
  const open = await within(sidebar()).findByRole("button", { name: /^Downloading / });
  await user.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(within(dialog).queryByText(/This session uses/)).toBeNull();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a model" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(open));
});

test("in a session the row opens that session's dialog", async () => {
  const { fake, user } = await mount("/s/a");
  progress(fake, 1_200_000_000);
  await user.click(await within(sidebar()).findByRole("button", { name: /^Downloading / }));
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(within(dialog).getByText(/This session uses/)).toBeTruthy();
});

test("a failure shows, can be dismissed, and a stop shows nothing", async () => {
  const { fake, user } = await mount("/");
  progress(fake, 1_200_000_000);
  done(fake, false, "no space left on device");
  const failed = await within(sidebar()).findByRole("button", { name: `Download of ${NAME} failed: no space left on device. Open models` });
  expect(failed).toBeTruthy();
  await user.click(within(sidebar()).getByRole("button", { name: `Dismiss: Download of ${NAME} failed` }));
  expect(within(sidebar()).queryByRole("button", { name: /failed/ })).toBeNull();
  progress(fake, 1_200_000_000);
  done(fake, false, "cancelled");
  await waitFor(() => expect(row()).toBeNull());
  expect(within(sidebar()).queryByRole("button", { name: /failed/ })).toBeNull();
});

test("the live region speaks on start, finish and failure, and not on each percent", async () => {
  const { fake } = await mount("/");
  const region = () => sidebar().querySelector("[aria-live=polite]")!;
  progress(fake, 1_000_000_000);
  await waitFor(() => expect(region().textContent).toBe(`Downloading ${NAME}`));
  progress(fake, 2_000_000_000);
  expect(region().textContent).toBe(`Downloading ${NAME}`);
  done(fake, true);
  await waitFor(() => expect(region().textContent).toBe(`${NAME} downloaded`));
  progress(fake, 1_000_000_000);
  done(fake, false, "no space");
  await waitFor(() => expect(region().textContent).toBe(`Download of ${NAME} failed`));
});

test("the row has no accessibility violations", async () => {
  const { fake, container } = await mount("/");
  progress(fake, 1_200_000_000);
  await within(sidebar()).findByRole("button", { name: /^Downloading / });
  expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
});
