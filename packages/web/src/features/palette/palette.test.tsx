import { COMMANDS } from "@golem/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";
import { NO_COMPOSER } from "./command-palette.tsx";
import { closePalette } from "./open.ts";

const popup = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const CWD = "/Users/you/repos/golem";

function setup(path: string) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listSkills.mockResolvedValue({ skills: [] } as never);
  fake.raw.listModels.mockResolvedValue(SAMPLE_LISTING);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, ...view, user: userEvent.setup() };
}

async function session() {
  const view = setup("/s/a");
  act(() => {
    view.fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    view.fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "qwen3:8b", title: "UTF-8 split" }));
  });
  return view;
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const palette = () => screen.getByRole("dialog", { name: "Commands" });
const search = () => within(palette()).getByRole("combobox", { name: "Search commands" }) as HTMLInputElement;
const options = () => within(palette()).getAllByRole("option");
const active = () => options().find((option) => option.getAttribute("aria-selected") === "true");
const gone = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
const dockNotice = () =>
  Array.from(document.querySelectorAll('[role="status"]'))
    .map((node) => node.textContent ?? "")
    .find((text) => text !== "") ?? null;

const ctrlK = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "k", ctrlKey: true });
const metaK = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "k", metaKey: true });

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
  await screen.findByRole("dialog", { name: "Commands" });
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  closePalette();
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

test("Ctrl+K opens the palette from the composer, a second press closes it, and focus returns", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  expect(document.activeElement).toBe(search());
  ctrlK();
  await gone();
  expect(document.activeElement).toBe(box());
});

test("on macOS it is ⌘K, and Ctrl+K does nothing", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await session();
  ctrlK();
  expect(screen.queryByRole("dialog")).toBeNull();
  metaK();
  await screen.findByRole("dialog", { name: "Commands" });
});

test("it opens from the page body, and Esc closes it and gives focus back", async () => {
  const { user } = await session();
  await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
  const before = document.activeElement;
  ctrlK();
  await screen.findByRole("dialog", { name: "Commands" });
  await user.keyboard("{Escape}");
  await gone();
  expect(document.activeElement).toBe(before);
});

test("it does not open over another dialog", async () => {
  const { user } = await session();
  await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
  await user.keyboard("?");
  await screen.findByRole("dialog", { name: "Keys" });
  ctrlK();
  await wait();
  expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Keys" })).toBeTruthy();
});

test("the rows are grouped, typing filters, and the arrow keys move", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  const headings = within(palette())
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label") ?? document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent);
  expect(headings).toEqual(["Session", "Model", "Tools", "View"]);
  const first = active();
  expect(first?.textContent).toContain("/close");
  await user.keyboard("{ArrowDown}");
  expect(active()).toBe(options()[1]);
  await user.keyboard("{ArrowUp}{ArrowUp}");
  expect(active()).toBe(options()[0]);
  await user.type(search(), "mo");
  expect(options()[0]?.textContent).toContain("/model");
  expect(active()).toBe(options()[0]);
  expect(options().length).toBeLessThan(COMMANDS.length);
});

test("a row shows the name, the arguments, the description, and a key; terminal commands say so", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  const help = options().find((option) => option.textContent?.includes("/help"));
  expect(help?.querySelector("kbd")?.textContent).toBe("?");
  const logout = options().find((option) => option.textContent?.includes("/logout"));
  expect(logout?.textContent).toContain("<provider>");
  const skills = options().find((option) => option.textContent?.includes("/skills"));
  expect(skills?.textContent).toContain("In the terminal for now");
  const mcp = options().find((option) => option.textContent?.includes("/mcp"));
  expect(mcp?.textContent).not.toContain("In the terminal for now");
  expect(help?.textContent).not.toContain("In the terminal for now");
});

test("Enter runs a command with no arguments in the composer on screen, and the palette closes", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  await user.type(search(), "title");
  await user.keyboard("{Enter}");
  await gone();
  await waitFor(() => expect(dockNotice()).toBe("Title: UTF-8 split"));
  expect(document.activeElement).toBe(box());
});

test("a command with optional arguments runs at once, here /model opens its dialog", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  await user.type(search(), "/model");
  await user.keyboard("{Enter}");
  await screen.findByRole("dialog", { name: "Choose a model" });
  expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
});

test("a command with required arguments fills the composer with the caret at the end and focuses it", async () => {
  const { user } = await session();
  await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
  ctrlK();
  await screen.findByRole("dialog", { name: "Commands" });
  await user.type(search(), "logout");
  await user.keyboard("{Enter}");
  await gone();
  await waitFor(() => expect(box().value).toBe("/logout "));
  expect(document.activeElement).toBe(box());
  expect(box().selectionStart).toBe("/logout ".length);
  expect(dockNotice()).toBeNull();
});

test("filling the composer keeps the old draft in history, and ArrowUp brings it back", async () => {
  const { user } = await session();
  await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
  await user.click(box());
  await user.type(box(), "an unsent draft");
  await openPalette(user);
  await user.type(search(), "logout");
  await user.keyboard("{Enter}");
  await gone();
  await waitFor(() => expect(box().value).toBe("/logout "));
  // /logout has provider choices, so its suggestions are open; Escape closes them and Up is history again.
  await user.keyboard("{Escape}{Home}{ArrowUp}");
  await waitFor(() => expect(box().value).toBe("an unsent draft"));
});

test("text that matches no command is one Send row, and Enter sends it through the composer", async () => {
  const { fake, user } = await session();
  await user.click(box());
  await openPalette(user);
  await user.type(search(), "what is a golem");
  expect(options()).toHaveLength(1);
  expect(options()[0]?.textContent).toBe('Send "what is a golem"');
  expect(within(palette()).getByText("Message")).toBeTruthy();
  await user.keyboard("{Enter}");
  await gone();
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", "what is a golem"));
});

test("on the start page the Send row starts a session", async () => {
  const { fake, user } = setup("/");
  act(() => fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", CWD)));
  await user.click(box());
  await openPalette(user);
  await user.type(search(), "explain this repo");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_new", "explain this repo"));
});

test("text that starts with a slash and fits no command runs, and says it is unknown", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  await user.type(search(), "/nope");
  expect(options()[0]?.textContent).toBe('Send "/nope"');
  await user.keyboard("{Enter}");
  await waitFor(() => expect(dockNotice()).toBe("unknown command — /help lists them"));
});

test("a message held back by a run in progress goes to the composer", async () => {
  const { fake, user } = await session();
  act(() => fake.emitEvent(ev("a", "run.started", { run_id: "r1" })));
  await user.click(box());
  await openPalette(user);
  await user.type(search(), "wait for me");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(box().value).toBe("wait for me"));
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
});

test("with no composer on screen the palette lists the commands, says so, and Enter does nothing", async () => {
  const { user } = setup("/nowhere/at/all");
  await wait();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  ctrlK();
  await screen.findByRole("dialog", { name: "Commands" });
  expect(within(palette()).getByText(NO_COMPOSER)).toBeTruthy();
  expect(options().length).toBeGreaterThan(5);
  await user.keyboard("{Enter}");
  await wait();
  expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
});

test("the sidebar's Search button opens it, and focus returns to the button", async () => {
  const { user } = setup("/");
  const button = screen.getByRole("button", { name: /Search or run a command/ });
  expect(button.querySelector("kbd")?.textContent).toBe("Ctrl K");
  await user.click(button);
  await screen.findByRole("dialog", { name: "Commands" });
  await user.keyboard("{Escape}");
  await gone();
  expect(document.activeElement).toBe(button);
});

test("the Search button shows ⌘K on macOS, and New session has no ⌘N hint", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  setup("/");
  expect(screen.getByRole("button", { name: /Search or run a command/ }).querySelector("kbd")?.textContent).toBe("⌘K");
  expect(screen.getByRole("button", { name: /New session/ }).querySelector("kbd")).toBeNull();
  expect(screen.queryByText("⌘N")).toBeNull();
});

test("? opens the key list from the page, and focus returns", async () => {
  const { user } = await session();
  await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
  const before = document.activeElement;
  await user.keyboard("?");
  const keys = await screen.findByRole("dialog", { name: "Keys" });
  expect(within(keys).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Keys", "Page", "Composer", "Approval", "Model dialog"]);
  expect(within(keys).getByText("allow once")).toBeTruthy();
  await user.keyboard("{Escape}");
  await gone();
  expect(document.activeElement).toBe(before);
});

test("? typed in a field is a character, not the key list", async () => {
  const { user } = await session();
  await user.click(box());
  await user.keyboard("why?");
  expect(box().value).toBe("why?");
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Search or run a command/ }));
  await screen.findByRole("dialog", { name: "Commands" });
  await user.keyboard("?");
  expect(search().value).toBe("?");
  expect(screen.queryByRole("dialog", { name: "Keys" })).toBeNull();
});

test("the palette's Keys row opens the key list, and focus returns to where it was", async () => {
  const { user } = await session();
  await user.click(box());
  await openPalette(user);
  const row = options().find((option) => option.textContent?.startsWith("Keys"));
  expect(row?.querySelector("kbd")?.textContent).toBe("?");
  await user.type(search(), "keys");
  await user.keyboard("{Enter}");
  await screen.findByRole("dialog", { name: "Keys" });
  expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
  await user.keyboard("{Escape}");
  await gone();
  expect(document.activeElement).toBe(box());
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the palette, filtered, the Send row, and the key list in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const { user } = await session();
    await user.click(box());
    await openPalette(user);
    expect((await axe.run(palette(), popup)).violations).toEqual([]);
    await user.type(search(), "mo");
    expect((await axe.run(palette(), popup)).violations).toEqual([]);
    await user.clear(search());
    await user.type(search(), "zzz nothing");
    expect(options()[0]?.textContent).toBe('Send "zzz nothing"');
    expect((await axe.run(palette(), popup)).violations).toEqual([]);
    await user.keyboard("{Escape}");
    await gone();
    await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
    await user.keyboard("?");
    const keys = await screen.findByRole("dialog", { name: "Keys" });
    expect((await axe.run(keys, popup)).violations).toEqual([]);
  });
}

test("the Trace row is offered with a session open, and picking it opens that session's trace", async () => {
  const { user, fake } = await session();
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: null, runs: [] } as never);
  await openPalette(user);
  await user.type(search(), "trace");
  const row = options().find((option) => option.textContent?.includes("Model calls, context, tools, and timings of this session"));
  expect(row?.textContent).toContain("Trace");
  await user.keyboard("{Enter}");
  await gone();
  await waitFor(() => expect(location.pathname).toBe("/s/a/trace"));
  expect(await screen.findByText("Nothing to trace yet. Send a message first.")).toBeTruthy();
});

test("the Trace row is not on the start page", async () => {
  const { user } = setup("/");
  await wait();
  await openPalette(user);
  await user.type(search(), "trace");
  expect(options().some((option) => option.textContent?.includes("timings of this session"))).toBe(false);
});
