import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closeHelper, openHelper, setDetail } from "../chat/index.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

type Fake = ReturnType<typeof fakeClient>;
type Data = Record<string, unknown>;
type Type = Parameters<typeof ev>[1];

const BRIEF = "Find where the session token is refreshed and say which file and line.";

/** What each helper session replays when the page attaches to it. */
const replay: Record<string, (send: (type: Type, data: Data) => void) => void> = {
  h1: (send) => {
    send("run.started", {});
    send("message.completed", { message_id: "hu", role: "user", text: BRIEF });
    send("message.started", { message_id: "ha", role: "assistant" });
    send("message.thinking.delta", { message_id: "ha", text: "Start with the auth module." });
    send("message.completed", { message_id: "ha", role: "assistant", text: "I read the auth module. It is probably auth/session.py:88." });
    send("tool.requested", { call_id: "t1", message_id: "ha", name: "read_file", args: { path: "src/auth.py" } });
    send("tool.completed", { call_id: "t1", summary: "40 lines", preview: "x" });
  },
  h2: (send) => {
    send("run.started", {});
    send("message.completed", { message_id: "hu", role: "user", text: "List the docs." });
    send("message.started", { message_id: "ha", role: "assistant" });
    send("message.completed", { message_id: "ha", role: "assistant", text: "Done. The docs are in docs/." });
    send("run.completed", {});
  },
  h3: (send) => {
    send("run.started", {});
    send("message.completed", { message_id: "hu", role: "user", text: "Fix the note." });
    send("message.started", { message_id: "ha", role: "assistant" });
    send("message.completed", { message_id: "ha", role: "assistant", text: "I want to write the finding down." });
    send("tool.requested", { call_id: "w1", message_id: "ha", name: "write_file", args: { path: "notes/refresh.md" } });
    send("approval.needed", { call_id: "w1", name: "write_file", args: { path: "notes/refresh.md" }, source: "built-in default", subject: "notes/refresh.md" });
  },
};

async function setup(helpers: readonly string[] = ["h1", "h2"]) {
  history.replaceState(null, "", "/s/a");
  const fake: Fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  fake.raw.attachSession.mockImplementation(async (id: string) => {
    const lines = replay[id];
    if (lines !== undefined) {
      lines((type, data) => {
        fake.emitEvent(ev(id, type, data));
      });
    }
    return {} as never;
  });
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "Fix the token refresh" });
  });
  await wait();
  const send = (type: Type, data: Data) => {
    act(() => {
      fake.emitEvent(ev("a", type, data));
    });
  };
  send("session.created", { cwd: "/Users/you/repos/golem", model_profile: "local", model_name: "m" });
  send("run.started", {});
  send("message.completed", { message_id: "u0", role: "user", text: "Look into the token refresh" });
  send("message.started", { message_id: "m1", role: "assistant" });
  send("message.completed", { message_id: "m1", role: "assistant", text: "I will ask helpers." });
  send("tool.requested", { call_id: "d1", message_id: "m1", name: "delegate", args: { brief: BRIEF } });
  helpers.forEach((id, index) => {
    send("helper.started", { call_id: "d1", index, helper_id: id, agent: "explorer", label: index === 0 ? "explorer" : "docs", model: "qwen3:27b", wish: "same", pick_reason: "" });
  });
  return { fake, ...view };
}

const panel = () => screen.queryByRole("complementary", { name: "Helper panel" });

async function openFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Open explorer, / }));
  await wait();
  return within(panel() as HTMLElement);
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
  // At Verbose the batch card shows its rows, and each row is a button that opens its helper.
  setDetail("verbose");
});
afterEach(() => {
  setDetail("normal");
  closeHelper();
  history.replaceState(null, "", "/");
  localStorage.clear();
});

test("a helper opens in the panel with its brief, its summary and its limits line, and no composer", async () => {
  const user = userEvent.setup();
  const { fake } = await setup();
  const inside = await openFirst(user);
  expect(fake.raw.attachSession).toHaveBeenCalledWith("h1");
  expect(inside.getByRole("heading", { name: "explorer" })).toBeTruthy();
  expect(inside.getByText(/^Find where the session token is/, { selector: "section[aria-label=Brief] p:last-child" })).toBeTruthy();
  expect(inside.getByText('helper of "Fix the token refresh" · qwen3:27b', { exact: false })).toBeTruthy();
  expect(inside.getByText("read 1 file")).toBeTruthy();
  expect(inside.getByLabelText("Limits").textContent).toMatch(/^\d+ calls? · /);
  expect(inside.getByRole("radio", { name: "Summary" }).getAttribute("aria-checked")).toBe("true");
  expect(inside.queryByRole("textbox")).toBeNull();
  expect(inside.getByRole("button", { name: "Open as chat" })).toBeTruthy();
});

test("Everything shows every step of the helper's run", async () => {
  const user = userEvent.setup();
  await setup();
  const inside = await openFirst(user);
  await user.click(inside.getByRole("radio", { name: "Everything" }));
  expect(inside.getByText("I read the auth module. It is probably auth/session.py:88.")).toBeTruthy();
  expect(inside.getByText("read_file")).toBeTruthy();
  expect(inside.getByText(BRIEF)).toBeTruthy();
  expect(inside.queryByRole("textbox")).toBeNull();
});

test("the lead's transcript is still on screen while the panel is open", async () => {
  const user = userEvent.setup();
  await setup();
  expect(screen.getByText("Look into the token refresh")).toBeTruthy();
  await openFirst(user);
  expect(screen.getByText("Look into the token refresh")).toBeTruthy();
  expect(screen.getByText("I will ask helpers.")).toBeTruthy();
  // The lead's composer is still there too.
  expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
});

test("a helper that asks shows its question in both views and the buttons answer for its session", async () => {
  const user = userEvent.setup();
  const { fake } = await setup(["h3"]);
  await user.click(await screen.findByRole("button", { name: /^Open explorer, / }));
  await wait();
  const inside = within(panel() as HTMLElement);
  expect(inside.getByText("wants to use write_file: notes/refresh.md")).toBeTruthy();
  await user.click(inside.getByRole("radio", { name: "Everything" }));
  expect(inside.getByText("wants to use write_file: notes/refresh.md")).toBeTruthy();
  await user.click(inside.getByRole("button", { name: /^Allow once/ }));
  expect(fake.raw.respondApproval).toHaveBeenCalledTimes(1);
  expect(fake.raw.respondApproval.mock.calls[0]?.slice(0, 2)).toEqual(["h3", "w1"]);
});

test("a done helper shows its answer to the lead and no Stop", async () => {
  const user = userEvent.setup();
  await setup();
  const inside = await openFirst(user);
  await user.click(inside.getByRole("button", { name: "Next helper" }));
  await wait();
  const next = within(panel() as HTMLElement);
  expect(next.getByRole("heading", { name: "docs" })).toBeTruthy();
  expect(next.getByText("answer to the lead")).toBeTruthy();
  expect(next.getByText("Done. The docs are in docs/.")).toBeTruthy();
  expect(next.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a helper opened by its id alone, as the sidebar card does, finds its call in the lead's log", async () => {
  await setup();
  expect(panel()).toBeNull();
  act(() => {
    openHelper({ helperId: "h2", leadId: "a" });
  });
  await wait();
  const inside = within(panel() as HTMLElement);
  expect(inside.getByRole("heading", { name: "docs" })).toBeTruthy();
  // Next helper works too: the call came from the lead's log.
  await userEvent.setup().click(inside.getByRole("button", { name: "Next helper" }));
  await wait();
  expect(within(panel() as HTMLElement).getByRole("heading", { name: "explorer" })).toBeTruthy();
});

test("Stop stops the helper through helper.stop while it works", async () => {
  const user = userEvent.setup();
  const { fake } = await setup();
  const inside = await openFirst(user);
  await user.click(inside.getByRole("button", { name: "Stop" }));
  expect(fake.raw.stopHelper).toHaveBeenCalledWith("h1");
  expect(fake.raw.cancelRun).not.toHaveBeenCalled();
});

test("Next helper moves on in the batch and round again; esc closes the panel and detaches", async () => {
  const user = userEvent.setup();
  const { fake } = await setup();
  const first = await openFirst(user);
  await user.click(first.getByRole("button", { name: "Next helper" }));
  await wait();
  expect(within(panel() as HTMLElement).getByRole("heading", { name: "docs" })).toBeTruthy();
  await user.click(within(panel() as HTMLElement).getByRole("button", { name: "Next helper" }));
  await wait();
  expect(within(panel() as HTMLElement).getByRole("heading", { name: "explorer" })).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(panel()).toBeNull();
  // The drawer's tabs are back, and the helper's session is detached.
  expect(screen.getByRole("complementary", { name: "Details" })).toBeTruthy();
  expect(fake.raw.detachSession).toHaveBeenCalledWith("h1");
});

test("Open as chat shows the helper full width under a banner with Back to lead, Stop and no composer", async () => {
  const user = userEvent.setup();
  const { fake } = await setup();
  const inside = await openFirst(user);
  await user.click(inside.getByRole("button", { name: "Open as chat" }));
  await wait();
  expect(location.pathname).toBe("/s/h1");
  expect(location.search).toBe("?lead=a");
  expect(panel()).toBeNull();
  const banner = within(screen.getByRole("region", { name: "Helper banner" }));
  expect(banner.getByText("Fix the token refresh")).toBeTruthy();
  expect(banner.getByText("explorer")).toBeTruthy();
  expect(banner.getByText("qwen3:27b")).toBeTruthy();
  expect(screen.getByText("Read-only: the lead talks to this helper.")).toBeTruthy();
  expect(screen.getByText("I read the auth module. It is probably auth/session.py:88.")).toBeTruthy();
  expect(within(screen.getByRole("main")).queryByRole("textbox")).toBeNull();
  await user.click(banner.getByRole("button", { name: "Stop" }));
  expect(fake.raw.stopHelper).toHaveBeenCalledWith("h1");
  await user.click(banner.getByRole("link", { name: "Back to lead" }));
  expect(location.pathname).toBe("/s/a");
});

test("a finished helper's banner has no Stop", async () => {
  const user = userEvent.setup();
  await setup();
  await user.click(await screen.findByRole("button", { name: /^Open docs, / }));
  await wait();
  await user.click(within(panel() as HTMLElement).getByRole("button", { name: "Open as chat" }));
  await wait();
  const banner = within(screen.getByRole("region", { name: "Helper banner" }));
  expect(banner.getByText("explorer")).toBeTruthy();
  expect(banner.queryByRole("button", { name: "Stop" })).toBeNull();
});

/** The lead's log says h2 ended; the list says its steps were trimmed. */
async function setupTrimmed() {
  const made = await setup();
  act(() => {
    made.fake.emitEvent(
      ev("a", "helper.ended", { call_id: "d1", index: 1, stopped: "done", model_calls: 3, tokens: 14_000, answer_tokens: 620, cost_usd: 0.01, duration_ms: 72_000, working_ms: 70_000 }),
    );
    made.fake.emitSummary({ ...summary("h2", "2026-11-19T03:00:00Z"), parent_session_id: "a", agent: "docs", trimmed_at: "2026-11-19T03:00:00Z" });
  });
  await wait();
  return made;
}

test("a trimmed helper opens in the panel as a receipt, not as steps", async () => {
  const user = userEvent.setup();
  await setupTrimmed();
  await user.click(await screen.findByRole("button", { name: /^Open docs, / }));
  await wait();
  const inside = within(panel() as HTMLElement);
  const receipt = within(inside.getByRole("region", { name: "Helper receipt" }));
  expect(receipt.getByText("List the docs.")).toBeTruthy();
  expect(receipt.getByText("Answered · qwen3:27b · 14.0K tokens · $0.01 · 1m 10s")).toBeTruthy();
  expect(receipt.getByText("Steps removed on 2026-11-19")).toBeTruthy();
  expect(receipt.getByText("The answer is in the lead's chat.")).toBeTruthy();
  expect(inside.queryByRole("radio", { name: "Everything" })).toBeNull();
});

test("a trimmed helper opened as a chat shows the receipt with a link to the lead and no transcript", async () => {
  const user = userEvent.setup();
  await setupTrimmed();
  await user.click(await screen.findByRole("button", { name: /^Open docs, / }));
  await wait();
  await user.click(within(panel() as HTMLElement).getByRole("button", { name: "Open as chat" }));
  await wait();
  const receipt = within(screen.getByRole("region", { name: "Helper receipt" }));
  expect(receipt.getByText("Steps removed on 2026-11-19")).toBeTruthy();
  expect(screen.queryByText("Done. The docs are in docs/.")).toBeNull();
  await user.click(receipt.getByRole("link", { name: "lead's chat" }));
  expect(location.pathname).toBe("/s/a");
});

test("a daemon without trimmed_at shows the steps as before", async () => {
  const user = userEvent.setup();
  await setup();
  await user.click(await screen.findByRole("button", { name: /^Open docs, / }));
  await wait();
  expect(screen.queryByRole("region", { name: "Helper receipt" })).toBeNull();
  expect(within(panel() as HTMLElement).getByRole("radio", { name: "Summary" })).toBeTruthy();
});

async function openSecond(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Open docs, / }));
  await wait();
  return within(panel() as HTMLElement);
}

test("a helper that runs or asks has no Continue as chat; a finished one forks and opens the new chat", async () => {
  const user = userEvent.setup();
  const { fake } = await setup(["h1", "h2"]);
  const first = await openFirst(user);
  expect(first.queryByRole("button", { name: "Continue as chat" })).toBeNull();
  await user.click(first.getByRole("button", { name: "Next helper" }));
  await wait();
  const next = within(panel() as HTMLElement);
  await user.click(next.getByRole("button", { name: "Continue as chat" }));
  await wait();
  expect(fake.raw.forkSession).toHaveBeenCalledWith("h2");
  expect(location.pathname).toBe("/s/s_fork");
});

test("the banner of a finished helper has Continue as chat and a running one does not", async () => {
  const user = userEvent.setup();
  const { fake } = await setup(["h1", "h2"]);
  const first = await openFirst(user);
  await user.click(first.getByRole("button", { name: "Open as chat" }));
  await wait();
  const running = within(screen.getByRole("region", { name: "Helper banner" }));
  expect(running.queryByRole("button", { name: "Continue as chat" })).toBeNull();
  await user.click(running.getByRole("link", { name: "Back to lead" }));
  await wait();
  const inside = await openSecond(user);
  await user.click(inside.getByRole("button", { name: "Open as chat" }));
  await wait();
  const banner = within(screen.getByRole("region", { name: "Helper banner" }));
  await user.click(banner.getByRole("button", { name: "Continue as chat" }));
  await wait();
  expect(fake.raw.forkSession).toHaveBeenCalledWith("h2");
  expect(location.pathname).toBe("/s/s_fork");
});

test("a refused Continue as chat says why next to the button and stays on the helper", async () => {
  const user = userEvent.setup();
  const { fake } = await setup(["h1", "h2"]);
  fake.raw.forkSession.mockRejectedValueOnce(new Error("This helper's steps were removed, so it cannot be continued."));
  const inside = await openSecond(user);
  await user.click(inside.getByRole("button", { name: "Continue as chat" }));
  await wait();
  expect((await within(panel() as HTMLElement).findByRole("alert")).textContent).toBe("This helper's steps were removed, so it cannot be continued.");
  expect(location.pathname).toBe("/s/a");
});

test("a trimmed helper has no Continue as chat, in the panel or as a chat", async () => {
  const user = userEvent.setup();
  await setupTrimmed();
  const inside = await openSecond(user);
  expect(inside.queryByRole("button", { name: "Continue as chat" })).toBeNull();
  await user.click(inside.getByRole("button", { name: "Open as chat" }));
  await wait();
  const banner = within(screen.getByRole("region", { name: "Helper banner" }));
  expect(banner.queryByRole("button", { name: "Continue as chat" })).toBeNull();
});
