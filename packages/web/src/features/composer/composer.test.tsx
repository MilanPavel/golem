import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider, useDraft } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, SESSION_BUSY_CODE } from "../../store/test-support.ts";
import { SESSION_BUSY_TEXT } from "../../store/errors.ts";
import { SessionDock } from "./session-dock.tsx";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup(sessionId = "a", connected = true) {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  if (connected) {
    fake.setState({ status: "connected" });
  }
  const tree = (id: string) => (
    <PageProvider page={page}>
      <SessionDock sessionId={id} />
    </PageProvider>
  );
  const view = render(tree(sessionId));
  return { fake, page, view, tree, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

test("Enter sends and clears; Shift+Enter adds a line", async () => {
  const { fake, user } = setup();
  await user.click(box());
  await user.keyboard("hello{Shift>}{Enter}{/Shift}world");
  expect(box().value).toBe("hello\nworld");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", "hello\nworld");
  expect(box().value).toBe("");
});

test("Enter during an IME composition sends nothing", async () => {
  const { fake, user } = setup();
  await user.type(box(), "ni");
  fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
  await wait();
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  expect(box().value).toBe("ni");
});

test("an empty draft sends nothing, and the composer is disabled with a reason when not connected", async () => {
  const { fake, user } = setup("a", false);
  expect(box().disabled).toBe(true);
  expect(box().placeholder).toBe("Not connected to golem");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  act(() => fake.setState({ status: "connected" }));
  await user.click(box());
  await user.keyboard("{Enter}");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
});

const NINE = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");

test("a long paste becomes a token, sending expands it, and short pastes stay text", async () => {
  const { fake, user } = setup();
  await user.click(box());
  await user.paste("short one");
  expect(box().value).toBe("short one");
  await user.paste(NINE);
  expect(box().value).toBe("short one[Pasted text #1 +8 lines]");
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", `short one${NINE}`);
  expect(JSON.parse(localStorage.getItem("golem.history") ?? "[]")).toEqual([`short one${NINE}`]);
});

test("deleting a token's text forgets its paste", async () => {
  const { fake, user } = setup();
  await user.click(box());
  await user.paste(NINE);
  await user.clear(box());
  await user.paste("[Pasted text #1 +8 lines]");
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", "[Pasted text #1 +8 lines]");
});

test("Up at the start recalls older texts, Down at the end goes newer and back to the draft", async () => {
  localStorage.setItem("golem.history", JSON.stringify(["first", "second"]));
  const { user } = setup();
  await user.click(box());
  await user.type(box(), "draft");
  await user.keyboard("{Home}");
  await user.keyboard("{ArrowUp}");
  expect(box().value).toBe("second");
  await user.keyboard("{ArrowUp}");
  expect(box().value).toBe("first");
  await user.keyboard("{ArrowUp}");
  expect(box().value).toBe("first");
  await user.keyboard("{ArrowDown}");
  expect(box().value).toBe("second");
  await user.keyboard("{ArrowDown}");
  expect(box().value).toBe("draft");
});

test("Up in the middle of a draft moves the caret instead of recalling", async () => {
  localStorage.setItem("golem.history", JSON.stringify(["old"]));
  const { user } = setup();
  await user.click(box());
  await user.type(box(), "abc");
  await user.keyboard("{ArrowUp}");
  expect(box().value).toBe("abc");
});

test("a sent text joins the history once, and the draft is kept per session when switching", async () => {
  const { fake, user, view, tree } = setup("a");
  await user.type(box(), "kept for a");
  view.rerender(tree("b"));
  expect(box().value).toBe("");
  await user.type(box(), "only b");
  view.rerender(tree("a"));
  expect(box().value).toBe("kept for a");
  view.rerender(tree("b"));
  expect(box().value).toBe("only b");
  await user.keyboard("{Enter}");
  await user.type(box(), "only b");
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem("golem.history") ?? "[]")).toEqual(["only b"]);
});

test("a draft written in the store shows in the composer", () => {
  function Writer() {
    const [, set] = useDraft("a");
    return <button onClick={() => set("from store")}>fill</button>;
  }
  const fake = fakeClient();
  const page = createPage(fake.client, { frame: fakeFrame(), doc: Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <Writer />
      <SessionDock sessionId="a" />
    </PageProvider>,
  );
  fireEvent.click(screen.getByText("fill"));
  expect(box().value).toBe("from store");
});

test("a failed send puts the text back and shows one line", async () => {
  const { fake, user } = setup();
  fake.raw.sendMessage.mockRejectedValueOnce(new Error("socket closed"));
  await user.type(box(), "please{Enter}");
  await wait();
  expect(box().value).toBe("please");
  expect(screen.getByRole("alert").textContent).toBe("socket closed");
});

test("a busy session explains itself", async () => {
  const { fake, user } = setup();
  fake.raw.sendMessage.mockRejectedValueOnce(rpcError(SESSION_BUSY_CODE, "busy"));
  await user.type(box(), "again{Enter}");
  await wait();
  expect(box().value).toBe("again");
  expect(screen.getByRole("alert").textContent).toBe(SESSION_BUSY_TEXT);
  expect(SESSION_BUSY_TEXT).toBe("golem is still answering. Stop it first, or wait.");
});

function startRun(fake: ReturnType<typeof setup>["fake"]) {
  act(() => fake.emitEvent(ev("a", "run.started")));
}

test("while a run is in progress the send button is Stop, Stop and Esc cancel it, and Enter sends nothing", async () => {
  const { fake, user } = setup();
  await wait();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  startRun(fake);
  expect(screen.getByText(/esc stop/)).toBeTruthy();
  await user.click(box());
  await user.type(box(), "more{Enter}");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toMatch(/Esc/);
  await user.keyboard("{Escape}");
  await wait();
  expect(fake.raw.cancelRun).toHaveBeenCalledWith("r1");
  await user.click(screen.getByRole("button", { name: "Stop" }));
  await wait();
  expect(fake.raw.cancelRun).toHaveBeenCalledTimes(2);
  act(() => fake.emitEvent(ev("a", "run.completed")));
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  expect(screen.queryByText(/esc stop/)).toBeNull();
});

test("the dock has no accessibility violations", async () => {
  const { view } = setup();
  expect((await axe.run(view.container, noContrast)).violations).toEqual([]);
});
