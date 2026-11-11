import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { ModeChipView } from "./mode-chip.tsx";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function setup(defaultMode: string | undefined = "balanced") {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  fake.raw.getConfig.mockResolvedValue({
    rules: [],
    ...(defaultMode === undefined ? {} : { default_permission_mode: defaultMode }),
  } as never);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "qwen3:8b", title: "UTF-8 split" }));
  });
  await wait();
  return fake;
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const chip = () => screen.getByRole("button", { name: /^Permission mode: / });
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const notice = () =>
  Array.from(document.querySelectorAll('[role="status"]'))
    .map((node) => node.textContent ?? "")
    .find((text) => text !== "") ?? null;

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(box());
  await user.type(box(), `${text}{Enter}`);
  await wait();
}

test("the chip shows the default, then the session's own mode from the event", async () => {
  const fake = await setup("careful");
  await waitFor(() => expect(chip().textContent).toBe("careful"));
  expect(chip().getAttribute("aria-label")).toBe("Permission mode: careful, the default. Change it.");
  expect(fake.raw.getConfig).toHaveBeenCalledWith(CWD, "a");
  act(() => fake.emitEvent(ev("a", "session.mode.changed", { mode: "autopilot" })));
  await waitFor(() => expect(chip().textContent).toBe("autopilot"));
  expect(chip().getAttribute("aria-label")).toBe("Permission mode: autopilot. Change it.");
});

test("an older daemon without the default reads balanced", async () => {
  await setup(undefined);
  await waitFor(() => expect(chip().textContent).toBe("balanced"));
});

test("the menu lists the modes with their lines, and a pick sets the mode", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await user.click(chip());
  const menu = await screen.findByRole("menu");
  const radios = within(menu).getAllByRole("menuitemradio");
  expect(radios.map((item) => item.textContent)).toEqual([
    "CarefulAsks before anything that is not a read.",
    "BalancedAlso runs web search and web fetch.",
    "AutopilotAlso edits inside the project and runs the sandboxed shell when it has no network.",
    "Use the default (balanced)",
  ]);
  expect(within(menu).getByRole("menuitemradio", { name: "Use the default (balanced)" }).getAttribute("aria-checked")).toBe("true");
  await user.click(within(menu).getByRole("menuitemradio", { name: /^Autopilot/ }));
  expect(fake.raw.setSessionMode).toHaveBeenCalledWith("a", "autopilot");
});

test("Use the default sends null", async () => {
  const fake = await setup();
  act(() => fake.emitEvent(ev("a", "session.mode.changed", { mode: "careful" })));
  await waitFor(() => expect(chip().textContent).toBe("careful"));
  const user = userEvent.setup();
  await user.click(chip());
  await user.click(await screen.findByRole("menuitemradio", { name: "Use the default (balanced)" }));
  expect(fake.raw.setSessionMode).toHaveBeenCalledWith("a", null);
});

test("a refused change shows on the dock's error line", async () => {
  const fake = await setup();
  fake.raw.setSessionMode.mockRejectedValue(rpcError(-32000, "no such mode"));
  const user = userEvent.setup();
  await user.click(chip());
  await user.click(await screen.findByRole("menuitemradio", { name: /^Careful/ }));
  await waitFor(() => expect(document.querySelector('[data-dock] [role="alert"]')?.textContent).toBe("no such mode"));
});

test("/mode reports, sets, and returns to the default", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await say(user, "/mode");
  expect(notice()).toBe("Mode: balanced, the default.");
  await say(user, "/mode autopilot");
  expect(fake.raw.setSessionMode).toHaveBeenLastCalledWith("a", "autopilot");
  expect(notice()).toContain("Mode: autopilot.");
  act(() => fake.emitEvent(ev("a", "session.mode.changed", { mode: "autopilot" })));
  await say(user, "/mode");
  expect(notice()).toBe("Mode: autopilot, set for this chat. /mode default follows balanced.");
  await say(user, "/mode default");
  expect(fake.raw.setSessionMode).toHaveBeenLastCalledWith("a", null);
  expect(notice()).toBe("Mode follows the default: balanced.");
  fake.raw.setSessionMode.mockRejectedValue(rpcError(-32000, "refused"));
  await say(user, "/mode careful");
  expect(document.querySelector('[data-dock] [role="alert"]')?.textContent).toBe("refused");
  await say(user, "/mode loud");
  expect(notice()).toContain("/mode, or /mode careful");
});

test("/mode on the empty screen asks for a session", async () => {
  history.replaceState(null, "", "/");
  const fake = fakeClient();
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  const user = userEvent.setup();
  await say(user, "/mode careful");
  expect(notice()).toBe("Start a session first: send a message.");
  expect(fake.raw.setSessionMode).not.toHaveBeenCalled();
});

for (const theme of ["slip", "kiln"]) {
  test(`the chip and its open menu pass axe in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    render(<ModeChipView own="careful" fallback="balanced" onSelect={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /^Permission mode: careful/ }));
    await screen.findByRole("menu");
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
}
