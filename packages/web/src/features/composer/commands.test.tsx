import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { detailStore, thinkingShownStore, timesShownStore } from "../chat/index.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const popup = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const CWD = "/Users/you/repos/golem";
const ANSWER = "Use this:\n\n```ts\nconst n = 1\n```\n\nDone.";

const SKILLS = {
  skills: [
    { name: "review", description: "Reviews the diff.", argument_hint: "[path]", path: "/s/review", source: "project", usable: true },
    { name: "notes", description: "Background notes.", path: "/s/notes", source: "user", usable: true, user_invocable: false },
  ],
} as never;

function setup(path: string) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listSkills.mockResolvedValue(SKILLS);
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

async function session(finished = true) {
  const view = setup("/s/a");
  act(() => {
    view.fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    view.fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "qwen3:8b", title: "UTF-8 split" }));
    if (finished) {
      view.fake.emitEvent(ev("a", "message.completed", { message_id: "m_1", role: "user", text: "hi" }));
      view.fake.emitEvent(ev("a", "message.completed", { message_id: "m_2", role: "assistant", text: ANSWER }));
    }
  });
  return view;
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const dockNotice = () =>
  Array.from(document.querySelectorAll('[role="status"]'))
    .map((node) => node.textContent ?? "")
    .find((text) => text !== "") ?? null;
const alertText = () => document.querySelector('[data-dock] [role="alert"]')?.textContent ?? null;

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(box());
  await user.type(box(), `${text}{Enter}`);
  await wait();
}

let writeText: ReturnType<typeof vi.fn>;
function mockClipboard(fail = false) {
  writeText = vi.fn(async () => {
    if (fail) throw new Error("denied");
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
  timesShownStore.set(true);
  thinkingShownStore.set(true);
  detailStore.set("normal");
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

test("an unknown command shows the notice and clears the draft", async () => {
  const { user } = await session();
  await say(user, "/nope");
  expect(dockNotice()).toBe("unknown command — /help lists them");
  expect(box().value).toBe("");
});

test("the notice clears when the draft changes", async () => {
  const { user } = await session();
  await say(user, "/nope");
  expect(dockNotice()).not.toBeNull();
  await user.type(box(), "a");
  expect(dockNotice()).toBeNull();
});

test("the next run clears the notice", async () => {
  const { user } = await session();
  await say(user, "/nope");
  await say(user, "/time");
  expect(dockNotice()).toBe("Times hidden.");
});

test("a command is not kept in history, a message is", async () => {
  const { fake, user } = await session();
  await say(user, "/nope");
  await say(user, "hello");
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", "hello");
  expect(JSON.parse(localStorage.getItem("golem.history") ?? "[]")).toEqual(["hello"]);
});

test("/help opens the Commands dialog, grouped, with the terminal-only ones marked, and focus comes back", async () => {
  const { user } = await session();
  await say(user, "/help");
  const dialog = screen.getByRole("dialog", { name: "Commands" });
  expect(within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Session", "Model", "Tools", "View"]);
  const skills = within(dialog).getByText("/skills").closest("li") as HTMLElement;
  expect(skills.textContent).toContain("In the terminal for now");
  const mcp = within(dialog).getByText("/mcp").closest("li") as HTMLElement;
  expect(mcp.textContent).not.toContain("In the terminal for now");
  const fork = within(dialog).getByText("/fork").closest("li") as HTMLElement;
  expect(fork.textContent).not.toContain("In the terminal for now");
  const permissions = within(dialog).getByText("/permissions").closest("li") as HTMLElement;
  expect(permissions.textContent).not.toContain("In the terminal for now");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(box()));
});

test("/permissions opens Settings on the tool rules", async () => {
  const { user } = await session();
  await say(user, "/permissions");
  expect(location.pathname).toBe("/settings/rules");
  expect(screen.getByRole("heading", { level: 2, name: "Tool rules" })).toBeTruthy();
});

test("/context opens the trace before any model call", async () => {
  const { user } = await session();
  await say(user, "/context");
  expect(location.pathname).toBe("/s/a/trace");
  expect(location.search).toBe("");
});

test("/context opens the trace with the newest model call selected", async () => {
  const { fake, user } = await session();
  act(() => {
    fake.emitEvent(ev("a", "model.call.started", { message_id: "m_3", context_window: 32768 }));
    fake.emitEvent(ev("a", "model.call.completed", { message_id: "m_3", usage: { input: 3400, output: 20 } }));
  });
  await say(user, "/context");
  expect(location.pathname).toBe("/s/a/trace");
  expect(location.search).toBe("?span=m_3");
});

test("/new goes to the start page", async () => {
  const { user } = await session();
  await say(user, "/new");
  expect(location.pathname).toBe("/");
});

test("/fork forks at the newest finished message and opens the fork", async () => {
  const { fake, user } = await session();
  await say(user, "/fork");
  expect(fake.raw.forkSession).toHaveBeenCalledWith("a", "m_2");
  await waitFor(() => expect(location.pathname).toBe("/s/s_fork"));
});

test("/fork with nothing finished says so", async () => {
  const { fake, user } = await session(false);
  await say(user, "/fork");
  expect(fake.raw.forkSession).not.toHaveBeenCalled();
  expect(dockNotice()).toBe("Nothing to fork yet.");
});

test("/fork that fails shows the error line", async () => {
  const { fake, user } = await session();
  fake.raw.forkSession.mockRejectedValue(rpcError(-32000, "no room"));
  await say(user, "/fork");
  expect(alertText()).toBe("no room");
});

test("/title renames, shows the title, and reports a refusal", async () => {
  const { fake, user } = await session();
  await say(user, "/title Plans for May");
  expect(fake.raw.renameSession).toHaveBeenCalledWith("a", "Plans for May");
  expect(dockNotice()).toBe("Renamed.");
  await say(user, "/title");
  expect(dockNotice()).toBe("Title: UTF-8 split");
  fake.raw.renameSession.mockRejectedValue(rpcError(-32000, "too long"));
  await say(user, "/title x");
  expect(alertText()).toBe("too long");
});

test("/close asks first, then closes and leaves the page", async () => {
  const { fake, user } = await session();
  await say(user, "/close");
  const dialog = screen.getByRole("dialog", { name: "Close this session?" });
  expect(fake.raw.closeSession).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(fake.raw.closeSession).toHaveBeenCalledWith("a");
  await waitFor(() => expect(location.pathname).toBe("/"));
});

test("/copy copies the last answer, /copy code the last code block", async () => {
  const { user } = await session();
  mockClipboard();
  await say(user, "/copy");
  expect(writeText).toHaveBeenLastCalledWith(ANSWER);
  expect(dockNotice()).toBe("Copied the last answer.");
  await say(user, "/copy code");
  expect(writeText).toHaveBeenLastCalledWith("const n = 1");
  expect(dockNotice()).toBe("Copied the last code block.");
});

test("/copy with nothing to copy, and with a clipboard that fails", async () => {
  const empty = await session(false);
  mockClipboard();
  await say(empty.user, "/copy");
  expect(dockNotice()).toBe("Nothing to copy yet.");
  await say(empty.user, "/copy code");
  expect(dockNotice()).toBe("No code block in the last answer.");
  expect(writeText).not.toHaveBeenCalled();
});

test("/copy with a refusing clipboard shows the error line", async () => {
  const { user } = await session();
  mockClipboard(true);
  await say(user, "/copy");
  expect(alertText()).toBe("denied");
});

test("/copy code with no block in the answer says so", async () => {
  const view = setup("/s/a");
  await wait();
  act(() => {
    view.fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "m" }));
    view.fake.emitEvent(ev("a", "message.completed", { message_id: "m_1", role: "assistant", text: "plain" }));
  });
  mockClipboard();
  await say(view.user, "/copy code");
  expect(dockNotice()).toBe("No code block in the last answer.");
});

test("/export downloads the session as markdown under its title", async () => {
  const { user } = await session();
  const create = vi.fn(() => "blob:x");
  const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  await say(user, "/export");
  expect(names).toEqual(["UTF-8 split.md"]);
  const blob = (create.mock.calls[0] as unknown as [Blob])[0];
  expect(blob.type).toBe("text/markdown");
  expect(await blob.text()).toContain("# UTF-8 split\n\n**you**\n\nhi\n\n**golem**");
  expect(revoke).toHaveBeenCalledWith("blob:x");
  expect(dockNotice()).toBe("Downloaded UTF-8 split.md.");
  await say(user, "/export ~/out.md");
  expect(dockNotice()).toBe("The page saves to your downloads: UTF-8 split.md.");
});

test("/time hides and shows the time beside messages and keeps the choice", async () => {
  const { user } = await session();
  expect(document.querySelector("article[aria-label='You'] time")).toBeTruthy();
  await say(user, "/time");
  expect(dockNotice()).toBe("Times hidden.");
  expect(document.querySelector("article[aria-label='You'] time")).toBeNull();
  expect(localStorage.getItem("golem.times")).toBe("hidden");
  await say(user, "/time");
  expect(dockNotice()).toBe("Times shown.");
  expect(document.querySelector("article[aria-label='You'] time")).toBeTruthy();
});

test("/detail shows the level, sets it, keeps it, and refuses other words", async () => {
  const { user } = await session();
  await say(user, "/detail");
  expect(dockNotice()).toBe("Detail is normal. /detail quiet, normal or verbose sets it.");
  await say(user, "/detail verbose");
  expect(dockNotice()).toBe("Detail is verbose.");
  expect(localStorage.getItem("golem.detail")).toBe("verbose");
  await say(user, "/detail loud");
  expect(dockNotice()).toBe("unknown command — /help lists them");
  expect(localStorage.getItem("golem.detail")).toBe("verbose");
});

test("/thinking toggles the choice and keeps it", async () => {
  const { user } = await session();
  await say(user, "/thinking");
  expect(dockNotice()).toBe("Thinking hidden.");
  expect(localStorage.getItem("golem.thinking")).toBe("hidden");
  await say(user, "/thinking");
  expect(dockNotice()).toBe("Thinking shown.");
  expect(localStorage.getItem("golem.thinking")).toBe("shown");
});

test("/todos toggles the drawer", async () => {
  const { user } = await session();
  expect(screen.queryByRole("complementary", { name: "Details" })).toBeTruthy();
  await say(user, "/todos");
  expect(dockNotice()).toBe("Todos hidden.");
  expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  await say(user, "/todos");
  expect(dockNotice()).toBe("Todos shown.");
  expect(screen.queryByRole("complementary", { name: "Details" })).toBeTruthy();
});

test("/model opens the model dialog, and focus returns to the composer", async () => {
  const { user } = await session();
  await say(user, "/model");
  await screen.findByRole("dialog", { name: "Choose a model" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(box());
});

test("/model <name> switches the session and reports a refusal", async () => {
  const { fake, user } = await session();
  await say(user, "/model ollama/gemma4:e4b");
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", "ollama/gemma4:e4b");
  expect(dockNotice()).toBe("Switched to ollama/gemma4:e4b.");
  fake.raw.setSessionModel.mockRejectedValue(rpcError(-32000, "unknown model"));
  await say(user, "/model nothing");
  expect(alertText()).toBe("unknown model");
});

test("/model pull and /model rm open the dialog with the question; an unknown name says so", async () => {
  const { user } = await session();
  await say(user, "/model pull qwen3:14b");
  let dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  const confirm = within(dialog).getByRole("group", { name: "Confirm" });
  expect(within(confirm).getByRole("button", { name: "Download" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await say(user, "/model rm ollama/gemma4:e4b");
  dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(within(within(dialog).getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Remove" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await say(user, "/model pull nope");
  expect(dockNotice()).toBe("No local model named nope. /model lists them.");
});

test("/skill pin and unpin call the daemon; the pinned list comes from events", async () => {
  const { fake, user } = await session();
  await say(user, "/skill pin review");
  expect(fake.raw.setSkills).toHaveBeenCalledWith("a", { pin: ["review"] });
  expect(dockNotice()).toBe("Pinned review.");
  act(() => {
    fake.emitEvent(ev("a", "skill.activated", { name: "review", how: "pinned" }));
  });
  await say(user, "/skill");
  expect(dockNotice()).toBe("pinned: review");
  await say(user, "/skill unpin review");
  expect(fake.raw.setSkills).toHaveBeenLastCalledWith("a", { unpin: ["review"] });
  expect(dockNotice()).toBe("Unpinned review.");
  fake.raw.setSkills.mockRejectedValue(rpcError(-32000, "no such skill"));
  await say(user, "/skill unpin review");
  expect(alertText()).toBe("no such skill");
});

test("/skill run and /<skill> send the line with the skill and its arguments", async () => {
  const { fake, user } = await session();
  await say(user, "/skill run review src/a.ts");
  expect(fake.raw.sendMessage).toHaveBeenLastCalledWith("a", "/skill run review src/a.ts", {
    skill: { name: "review", args: "src/a.ts" },
  });
  await say(user, "/review lib");
  expect(fake.raw.sendMessage).toHaveBeenLastCalledWith("a", "/review lib", { skill: { name: "review", args: "lib" } });
});

test("// sends a message that starts with a slash", async () => {
  const { fake, user } = await session();
  await say(user, "//etc is a folder");
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", "etc is a folder");
});

test("/login and /logout show the golem command to copy, and Copy says Copied for two seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { user } = await session();
  mockClipboard();
  await say(user, "/login anthropic");
  const line = within(screen.getByText("Keys are set in a terminal:").closest("p") as HTMLElement);
  expect(line.getByText("golem auth set anthropic").tagName).toBe("CODE");
  await user.click(line.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("golem auth set anthropic");
  await waitFor(() => expect(line.getByRole("button", { name: "Copied" })).toBeTruthy());
  act(() => {
    vi.advanceTimersByTime(2100);
  });
  expect(line.getByRole("button", { name: "Copy" })).toBeTruthy();
  await say(user, "/login");
  expect(screen.getByText("golem auth set <provider>")).toBeTruthy();
  await say(user, "/logout groq");
  expect(screen.getByText("golem auth remove groq")).toBeTruthy();
  vi.useRealTimers();
});

test("a clipboard that fails selects the command and does not throw", async () => {
  const { user } = await session();
  mockClipboard(true);
  await say(user, "/login openai");
  await user.click(screen.getByRole("button", { name: "Copy" }));
  await wait();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(window.getSelection()?.toString()).toBe("golem auth set openai");
});

test("/mcp add opens the Add dialog in Settings, on the server named, or on the list", async () => {
  const { fake, user } = await session();
  fake.raw.mcpCatalog.mockResolvedValue({
    entries: [
      { id: "github", name: "github", title: "GitHub", description: "Issues and PRs.", category: "code", homepage: "https://example.com", runtime: "url", auth: "token", inputs: [{ id: "token", kind: "secret", label: "Token" }] },
    ],
  });
  await say(user, "/mcp add github");
  expect(location.pathname).toBe("/settings/mcp");
  expect((await screen.findByRole("heading", { name: "Add GitHub" })).textContent).toBe("Add GitHub");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

const NOT_YET: [string, string][] = [
  ["/skills", "The skills list is in the terminal for now: run golem, then /skills."],
  ["/artifact", "Tool output opens in the terminal for now: run golem, then /artifact."],
  ["/sessions", "The sidebar lists your sessions."],
  ["/debug", "The debug panel is in the terminal for now: run golem, then /debug."],
];

for (const [line, text] of NOT_YET) {
  test(`${line} says where it lives`, async () => {
    const { user } = await session();
    await say(user, line);
    expect(dockNotice()).toBe(text);
  });
}

test("while a run is busy, a message keeps its draft with the hint, and a command still runs", async () => {
  const { fake, user } = await session();
  act(() => {
    fake.emitEvent(ev("a", "run.started"));
  });
  await say(user, "hello");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  expect(box().value).toBe("hello");
  expect(screen.getByText("golem is answering. Press Esc to stop it.")).toBeTruthy();
  await user.clear(box());
  await say(user, "/skill run review x");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  expect(box().value).toBe("/skill run review x");
  await user.clear(box());
  await say(user, "/time");
  expect(dockNotice()).toBe("Times hidden.");
  expect(box().value).toBe("");
});

test("the empty screen: suggestions work, /new does nothing, /help and /login work, session commands ask for a session", async () => {
  const { fake, user } = setup("/");
  await user.type(box(), "/");
  await wait();
  expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
  await user.clear(box());
  await say(user, "/new");
  expect(location.pathname).toBe("/");
  expect(box().value).toBe("");
  await say(user, "/login anthropic");
  expect(screen.getByText("golem auth set anthropic")).toBeTruthy();
  for (const line of ["/fork", "/title x", "/close", "/copy", "/export", "/model pull x", "/todos", "/mcp enable x"]) {
    await say(user, line);
    expect(dockNotice()).toBe("Start a session first: send a message.");
    expect(box().value).toBe("");
  }
  await say(user, "/time");
  expect(dockNotice()).toBe("Times hidden.");
  await say(user, "/help");
  expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
  expect(fake.raw.createSession).not.toHaveBeenCalled();
});

test("the empty screen: /model opens the dialog for the new session, and /model <name> sets the pick", async () => {
  const { fake, user } = setup("/");
  await say(user, "/model");
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(within(dialog).queryByText(/This session uses/)).toBeNull();
  expect(within(dialog).getByText(/New sessions use ollama\/gemma4:e4b/)).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(box());

  await say(user, "/model nothing");
  expect(dockNotice()).toBe("No model named nothing. /model lists them.");
  await say(user, "/model ollama/qwen3:14b");
  expect(dockNotice()).toBe("Qwen3 14B is not ready. /model opens the list, where it can be downloaded.");
  await say(user, "/model ollama/qwen3:8b");
  expect(dockNotice()).toBe("New sessions use Qwen3 8B.");
  expect(screen.getByRole("button", { name: "Model: Qwen3 8B" })).toBeTruthy();
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
  expect(fake.raw.createSession).not.toHaveBeenCalled();
});

test("the empty screen: a message starts a session, and so does /skill run", async () => {
  const { fake, user } = setup("/");
  await say(user, "/skill run review src");
  expect(fake.raw.createSession).toHaveBeenCalledTimes(1);
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_new", "/skill run review src", { skill: { name: "review", args: "src" } });
  await waitFor(() => expect(location.pathname).toBe("/s/s_new"));
});

for (const theme of ["slip", "kiln"]) {
  test(`axe: a notice with a command to copy, and the Commands dialog (${theme})`, async () => {
    document.documentElement.dataset.theme = theme;
    const { user, container } = await session();
    await say(user, "/login anthropic");
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await say(user, "/help");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });
}

test("/mcp opens the MCP servers section of Settings", async () => {
  const { user } = await session();
  await say(user, "/mcp");
  expect(location.pathname).toBe("/settings/mcp");
});

test("/mcp enable and /mcp disable turn a server on or off for this chat, and say so", async () => {
  const { fake, user } = await session();
  await say(user, "/mcp enable github");
  expect(fake.raw.enableMcp).toHaveBeenCalledWith("a", "github");
  expect(dockNotice()).toBe("github is on for this chat.");
  await say(user, "/mcp disable github");
  expect(fake.raw.disableMcp).toHaveBeenCalledWith("a", "github");
  expect(dockNotice()).toBe("github is off for this chat.");
  fake.raw.enableMcp.mockRejectedValueOnce(new Error("no server named nope"));
  await say(user, "/mcp enable nope");
  expect(screen.getByRole("alert").textContent).toContain("no server named nope");
});

test("/config opens Settings → Config file, and /config project opens the project's file", async () => {
  const { fake, user } = await session();
  fake.raw.configRawGet.mockResolvedValue({ exists: true, mtime_ns: 1, path: "/work/app/.golem/config.toml", text: "a = 1\n" });
  await say(user, "/config project");
  expect(location.pathname).toBe("/settings/config");
  expect(await screen.findByRole("textbox", { name: "Config file text" })).toBeTruthy();
  await waitFor(() => expect(fake.raw.configRawGet).toHaveBeenLastCalledWith({ scope: "project", sessionId: expect.any(String) }));
});
