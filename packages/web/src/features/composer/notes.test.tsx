import { withNotes, type NotesState } from "@golem/view";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { tabStore } from "../workbench/workbench-state.ts";
import { SessionDock } from "./session-dock.tsx";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const tree = (
    <PageProvider page={page}>
      <SessionDock sessionId="a" />
    </PageProvider>
  );
  const view = render(tree);
  act(() => {
    page.notes.add("a", { path: "src/socket.ts", line: 4, side: "new", code: "const delay = clamp(attempt, 0, 8);", text: "Why 8?" });
    page.notes.add("a", { path: "src/clamp.ts", line: 1, side: "new", code: "export function clamp() {}", text: "Add a doc comment." });
  });
  return { fake, page, view, tree, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
  tabStore.set(null);
});

test("the chip counts the notes, and the send button names them", async () => {
  setup();
  await wait();
  expect(screen.getByRole("button", { name: "2 notes. Open the Changes tab." })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send with notes" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Send with notes" }) as HTMLButtonElement).disabled).toBe(false);
});

test("the chip opens the panel on Changes", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "2 notes. Open the Changes tab." }));
  expect(tabStore.getSnapshot()).toBe("changes");
});

test("sending composes the text of withNotes and clears the notes", async () => {
  const { fake, page, user } = setup();
  const state: NotesState = page.notes.get("a");
  await user.type(box(), "fix these{Enter}");
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", withNotes(state, "fix these"));
  const sent = fake.raw.sendMessage.mock.calls[0]?.[1] as string;
  expect(sent).toContain("src/socket.ts:4");
  expect(sent).toContain("src/clamp.ts:1");
  expect(page.notes.get("a").notes).toEqual([]);
  expect(screen.queryByRole("button", { name: /Open the Changes tab/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});

test("with notes an empty box may be sent", async () => {
  const { fake, page, user } = setup();
  const state = page.notes.get("a");
  await user.click(screen.getByRole("button", { name: "Send with notes" }));
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", withNotes(state, ""));
  expect(page.notes.get("a").notes).toEqual([]);
});

test("a failed send keeps the notes", async () => {
  const { fake, page, user } = setup();
  fake.raw.sendMessage.mockRejectedValueOnce(new Error("socket closed"));
  await user.type(box(), "fix these{Enter}");
  await wait();
  expect(page.notes.get("a").notes).toHaveLength(2);
  expect(box().value).toBe("fix these");
});

test("a message that starts with // is not a command, so the notes go with it", async () => {
  const { fake, page, user } = setup();
  await user.type(box(), "//not a command{Enter}");
  await wait();
  expect(String(fake.raw.sendMessage.mock.calls[0]?.[1])).toContain("Review notes:");
  expect(page.notes.get("a").notes).toEqual([]);
});

test("the notes survive a remount of the dock", async () => {
  const { view, tree } = setup();
  view.unmount();
  render(tree);
  await wait();
  expect(screen.getByRole("button", { name: "2 notes. Open the Changes tab." })).toBeTruthy();
});

test("the x removes every note after a question", async () => {
  const { page, user } = setup();
  await user.click(screen.getByRole("button", { name: "Remove all notes" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(page.notes.get("a").notes).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Remove all notes" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  expect(page.notes.get("a").notes).toEqual([]);
});
