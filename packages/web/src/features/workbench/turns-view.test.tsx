import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { diffModeStore } from "../diff/diff-mode.ts";
import { SAMPLE_EDIT_DIFF } from "../diff/sample.ts";
import { ChangesTab } from "./changes-tab.tsx";
import { CHANGES_VIEW_KEY, changesViewStore } from "./changes-view.tsx";
import { WORKBENCH_DEFAULT, workbenchWidthStore } from "./workbench-width.ts";

type ChatEvent = ReturnType<typeof ev>;

const at = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

function request(run: string, text: string, minutes: number): ChatEvent {
  const event = ev("a", "message.completed", { message_id: `u-${run}`, role: "user", text });
  return { ...event, run_id: run, ts: at(minutes) } as ChatEvent;
}

function changed(run: string | null, id: string, path: string, over: Record<string, unknown> = {}): ChatEvent {
  const event = ev("a", "file.changed", { change_id: id, path, status: "modified", added: 3, removed: 1, source: "tool", ...over });
  return { ...event, run_id: run } as ChatEvent;
}

function setup(events: ChatEvent[]) {
  const fake = fakeClient();
  fake.raw.changesList.mockImplementation(async () => ({ files: [] }));
  fake.raw.changesDiff.mockImplementation(async () => ({ diff: SAMPLE_EDIT_DIFF, truncated: false }));
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document;
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <ChangesTab sessionId="a" />
    </PageProvider>,
  );
  act(() => {
    for (const event of events) fake.emitEvent(event);
  });
  return { fake, page };
}

const THREE: ChatEvent[] = [
  request("r1", "add retry with backoff to the fetcher", 14),
  changed("r1", "c1", "src/fetch.py"),
  request("r2", "also log each retry", 9),
  changed("r2", "c2", "src/fetch.py", { added: 4, removed: 0 }),
  request("r3", "make the wait configurable", 2),
  changed("r3", "c3", "src/fetch.py", { added: 5, removed: 2 }),
  changed("r3", "c4", "src/config.py", { added: 4, removed: 1 }),
];

beforeEach(() => {
  localStorage.clear();
  changesViewStore.set("turn");
  diffModeStore.set("unified");
  workbenchWidthStore.set(WORKBENCH_DEFAULT);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("ul > li[id]"));
}

test("three turns show newest first, numbered, with the request as title and their files", async () => {
  const { page } = setup(THREE);
  await waitFor(() => expect(cards()).toHaveLength(3));
  const [newest, middle, oldest] = cards() as [HTMLElement, HTMLElement, HTMLElement];
  expect(newest.textContent).toContain("3 · make the wait configurable");
  expect(newest.textContent).toContain("2m ago · 2 files +9 −3");
  expect(newest.textContent).toContain("config.py");
  expect(middle.textContent).toContain("2 · also log each retry");
  expect(middle.textContent).toContain("1 file +4");
  expect(oldest.textContent).toContain("1 · add retry with backoff to the fetcher");
  expect(screen.getByText("session start")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Turns, oldest first" })).getAllByRole("button")).toHaveLength(3);
  page.stop();
});

test("a long title is cut at 80 characters", async () => {
  const { page } = setup([request("r1", "x".repeat(120), 1), changed("r1", "c1", "a.py")]);
  await waitFor(() => expect(cards()).toHaveLength(1));
  expect(cards()[0]!.querySelector("p")!.textContent).toContain(`1 · ${"x".repeat(79)}…`);
  page.stop();
});

test("a file opens the diff of that turn's last change to it", async () => {
  const { fake, page } = setup(THREE);
  await waitFor(() => expect(cards()).toHaveLength(3));
  await userEvent.click(within(cards()[1]!).getByRole("button", { name: /fetch\.py/ }));
  await screen.findByRole("table");
  expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { changeId: "c2" });
  expect(screen.getAllByRole("table")).toHaveLength(1);
  await userEvent.click(within(cards()[0]!).getByRole("button", { name: /fetch\.py/ }));
  await waitFor(() => expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { changeId: "c3" }));
  page.stop();
});

test("files of two turns stay open together, and a click closes only its own", async () => {
  const { fake, page } = setup(THREE);
  await waitFor(() => expect(cards()).toHaveLength(3));
  const turn2 = (): HTMLElement => within(cards()[1]!).getByRole("button", { name: /fetch\.py/ });
  const turn1 = (): HTMLElement => within(cards()[0]!).getByRole("button", { name: /fetch\.py/ });
  await userEvent.click(turn2());
  await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(1));
  await userEvent.click(turn1());
  await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));
  expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { changeId: "c2" });
  expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { changeId: "c3" });
  expect(turn1().getAttribute("aria-expanded")).toBe("true");
  expect(turn2().getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(turn1());
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(turn1().getAttribute("aria-expanded")).toBe("false");
  expect(turn2().getAttribute("aria-expanded")).toBe("true");
  page.stop();
});

test("a reverted turn is muted and says undone; an undo draws no card", async () => {
  const { page } = setup([...THREE, changed(null, "u1", "src/fetch.py", { source: "revert", reverts: "c2", added: 0, removed: 4 })]);
  await waitFor(() => expect(cards()).toHaveLength(3));
  expect(cards()[1]!.getAttribute("data-reverted")).toBe("true");
  expect(cards()[1]!.textContent).toContain("undone");
  expect(cards()[0]!.getAttribute("data-reverted")).toBeNull();
  expect(cards()[0]!.textContent).not.toContain("undone");
  page.stop();
});

test("the switch is remembered and shows the other view", async () => {
  changesViewStore.set("file");
  const { page } = setup([]);
  page.acquire("a");
  act(() => {
    for (const event of THREE) page.sessions.get("a")?.dispatch(event);
  });
  expect(screen.getByRole("button", { name: "by file" }).getAttribute("aria-pressed")).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "by turn" }));
  expect(localStorage.getItem(CHANGES_VIEW_KEY)).toBe("turn");
  await waitFor(() => expect(cards()).toHaveLength(3));
  await userEvent.click(screen.getByRole("button", { name: "by file" }));
  expect(localStorage.getItem(CHANGES_VIEW_KEY)).toBe("file");
  expect(cards()).toHaveLength(0);
  page.stop();
});

test("with no changes it says so", async () => {
  const { page } = setup([]);
  expect(await screen.findByText(/No changes yet\. Each request/)).toBeTruthy();
  page.stop();
});
