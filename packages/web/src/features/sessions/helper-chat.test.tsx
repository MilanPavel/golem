import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closeHelper, setDetail } from "../chat/index.ts";
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
  await user.click(await screen.findByRole("button", { name: "Open explorer" }));
  await wait();
  return within(panel() as HTMLElement);
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
  // At Verbose the lead's steps are all on screen, with the helper line and its Open buttons.
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
  await user.click(await screen.findByRole("button", { name: "Open helper" }));
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

test("Stop cancels the helper's run while it works", async () => {
  const user = userEvent.setup();
  const { fake } = await setup();
  const inside = await openFirst(user);
  await user.click(inside.getByRole("button", { name: "Stop" }));
  expect(fake.raw.cancelRun).toHaveBeenCalledWith("r1");
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

test("Open as chat shows the helper full width with a breadcrumb back to the lead and no composer", async () => {
  const user = userEvent.setup();
  await setup();
  const inside = await openFirst(user);
  await user.click(inside.getByRole("button", { name: "Open as chat" }));
  await wait();
  expect(location.pathname).toBe("/s/h1");
  expect(location.search).toBe("?lead=a");
  expect(panel()).toBeNull();
  const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumb).getByRole("link", { name: "Fix the token refresh" })).toBeTruthy();
  expect(screen.getByText("I read the auth module. It is probably auth/session.py:88.")).toBeTruthy();
  expect(within(screen.getByRole("main")).queryByRole("textbox")).toBeNull();
  await user.click(within(crumb).getByRole("link", { name: "Fix the token refresh" }));
  expect(location.pathname).toBe("/s/a");
});
