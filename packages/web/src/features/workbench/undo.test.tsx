import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { Transcript } from "../chat/transcript.tsx";
import { diffModeStore } from "../diff/diff-mode.ts";
import { SAMPLE_EDIT_DIFF } from "../diff/sample.ts";
import { ChangesTab } from "./changes-tab.tsx";
import { changesViewStore } from "./changes-view.tsx";
import { WORKBENCH_DEFAULT, workbenchWidthStore } from "./workbench-width.ts";

type ChatEvent = ReturnType<typeof ev>;

const WAIT = "Wait for golem to finish";

const at = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

function request(run: string, text: string, minutes: number): ChatEvent {
  const event = ev("a", "message.completed", { message_id: `u-${run}`, role: "user", text });
  return { ...event, run_id: run, ts: at(minutes) } as ChatEvent;
}

function answer(run: string, id: string): ChatEvent {
  const event = ev("a", "message.completed", { message_id: id, role: "assistant", text: `done ${run}` });
  return { ...event, run_id: run } as ChatEvent;
}

function changed(run: string | null, id: string, path: string, over: Record<string, unknown> = {}): ChatEvent {
  const event = ev("a", "file.changed", { change_id: id, path, status: "modified", added: 3, removed: 1, source: "tool", ...over });
  return { ...event, run_id: run } as ChatEvent;
}

const THREE: ChatEvent[] = [
  request("r1", "add retry with backoff to the fetcher", 14),
  changed("r1", "c1", "src/fetch.py"),
  answer("r1", "m1"),
  request("r2", "also log each retry", 9),
  changed("r2", "c2", "src/fetch.py", { added: 4, removed: 0 }),
  answer("r2", "m2"),
  request("r3", "make the wait configurable", 2),
  changed("r3", "c3", "src/fetch.py", { added: 5, removed: 2 }),
  changed("r3", "c4", "src/config.py", { added: 4, removed: 1 }),
  answer("r3", "m3"),
];

const FILES = [
  { path: "src/fetch.py", status: "modified" as const, added: 12, removed: 3, change_ids: ["c1", "c2", "c3"], stale: false },
  { path: "src/config.py", status: "modified" as const, added: 4, removed: 1, change_ids: ["c4"], stale: false },
];

function setup(events: ChatEvent[], view: "turn" | "file", ui: "tab" | "transcript" = "tab") {
  changesViewStore.set(view);
  const fake = fakeClient();
  fake.raw.changesList.mockImplementation(async () => ({ files: FILES }));
  fake.raw.changesDiff.mockImplementation(async () => ({ diff: SAMPLE_EDIT_DIFF, truncated: false }));
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document;
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      {ui === "tab" ? <ChangesTab sessionId="a" /> : <Transcript id="a" />}
    </PageProvider>,
  );
  act(() => {
    for (const event of events) fake.emitEvent(event);
  });
  return { fake, page };
}

beforeEach(() => {
  localStorage.clear();
  diffModeStore.set("unified");
  workbenchWidthStore.set(WORKBENCH_DEFAULT);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const REVERTED = { reverted: ["src/fetch.py"], conflicts: [] };
const CONFLICT = { reverted: [], conflicts: [{ path: "src/fetch.py", reason: "changed_on_disk" as const }] };

test("Undo file sends the file target and needs no dialog", async () => {
  const { fake, page } = setup([], "file");
  fake.raw.changesRevert.mockResolvedValue(REVERTED);
  await userEvent.click(await screen.findByRole("button", { name: "Undo the changes to src/fetch.py" }));
  expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "file", path: "src/fetch.py" }, false);
  expect(screen.queryByRole("dialog")).toBeNull();
  page.stop();
});

test("a hunk header's Undo sends the hunk target with its index", async () => {
  const { fake, page } = setup([], "file");
  fake.raw.changesRevert.mockResolvedValue(REVERTED);
  await screen.findByRole("table");
  const hunks = screen.getAllByRole("button", { name: /^Undo hunk \d of src\/fetch\.py$/ });
  expect(hunks.length).toBeGreaterThan(1);
  await userEvent.click(hunks[1]!);
  expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "hunk", path: "src/fetch.py", hunk: 1 }, false);
  page.stop();
});

test("a conflict asks first, Overwrite sends force, Keep mine sends nothing more", async () => {
  const { fake, page } = setup([], "file");
  fake.raw.changesRevert.mockResolvedValueOnce(CONFLICT).mockResolvedValueOnce(REVERTED);
  await userEvent.click(await screen.findByRole("button", { name: "Undo the changes to src/fetch.py" }));
  const dialog = await screen.findByRole("dialog", { name: "These files changed since golem wrote them" });
  expect(within(dialog).getByText("src/fetch.py")).toBeTruthy();
  expect(within(dialog).getByText("Overwrite them?")).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "Overwrite" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fake.raw.changesRevert).toHaveBeenCalledTimes(2);
  expect(fake.raw.changesRevert).toHaveBeenLastCalledWith("a", { kind: "file", path: "src/fetch.py" }, true);

  fake.raw.changesRevert.mockResolvedValueOnce(CONFLICT);
  await userEvent.click(screen.getByRole("button", { name: "Undo the changes to src/fetch.py" }));
  await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fake.raw.changesRevert).toHaveBeenCalledTimes(3);
  page.stop();
});

test("every undo button is disabled while a run is active, with the reason as its title", async () => {
  const { page } = setup([], "file");
  const file = await screen.findByRole("button", { name: "Undo the changes to src/fetch.py" });
  await screen.findByRole("table");
  const hunk = screen.getAllByRole("button", { name: /^Undo hunk 1 of/ })[0]!;
  expect((file as HTMLButtonElement).disabled).toBe(false);
  act(() => {
    page.sessions.get("a")?.dispatch(ev("a", "run.started", {}));
  });
  await waitFor(() => expect((file as HTMLButtonElement).disabled).toBe(true));
  expect(file.getAttribute("title")).toBe(WAIT);
  expect((hunk as HTMLButtonElement).disabled).toBe(true);
  expect(hunk.getAttribute("title")).toBe(WAIT);
  page.stop();
});

test("by turn, Rewind to before this sends the run; a multi-turn rewind asks first and lists what it takes back", async () => {
  const { fake, page } = setup(THREE, "turn");
  fake.raw.changesRevert.mockResolvedValue(REVERTED);
  const buttons = await screen.findAllByRole("button", { name: /^Rewind to before this/ });
  expect(buttons).toHaveLength(3);
  // The newest turn alone: no dialog.
  await userEvent.click(buttons[0]!);
  expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "run", runId: "r3" }, false);
  expect(screen.queryByRole("dialog")).toBeNull();
  // The oldest turn takes three turns with it.
  fake.raw.changesRevert.mockClear();
  await userEvent.click(buttons[2]!);
  const dialog = await screen.findByRole("dialog", { name: "Rewind 3 turns?" });
  expect(fake.raw.changesRevert).not.toHaveBeenCalled();
  const turns = within(within(dialog).getByRole("list", { name: "Turns to take back" })).getAllByRole("listitem");
  expect(turns.map((item) => item.textContent)).toEqual(["3 · make the wait configurable", "2 · also log each retry", "1 · add retry with backoff to the fetcher"]);
  const files = within(within(dialog).getByRole("list", { name: "Files to put back" })).getAllByRole("listitem");
  expect(files.map((item) => item.textContent)).toEqual(["src/fetch.py", "src/config.py"]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Rewind" }));
  await waitFor(() => expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "run", runId: "r1" }, false));
  page.stop();
});

test("Cancel on the rewind dialog sends nothing", async () => {
  const { fake, page } = setup(THREE, "turn");
  const buttons = await screen.findAllByRole("button", { name: /^Rewind to before this/ });
  await userEvent.click(buttons[2]!);
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fake.raw.changesRevert).not.toHaveBeenCalled();
  page.stop();
});

test("a turn with a revert shows Redo, which reverts each revert, and the rewind buttons are disabled while busy", async () => {
  const events = [
    ...THREE,
    changed(null, "u1", "src/fetch.py", { source: "revert", reverts: "c2", added: 0, removed: 4 }),
    changed(null, "u2", "src/config.py", { source: "revert", reverts: "c4", added: 0, removed: 4 }),
  ];
  const { fake, page } = setup(events, "turn");
  fake.raw.changesRevert.mockResolvedValue(REVERTED);
  // c4 is in turn 3, c2 in turn 2: both turns are undone and each has a Redo.
  const redo = await screen.findAllByRole("button", { name: /^Redo/ });
  expect(redo).toHaveLength(2);
  await userEvent.click(redo[1]!);
  await waitFor(() => expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "change", changeId: "u1" }, false));
  act(() => {
    page.sessions.get("a")?.dispatch(ev("a", "run.started", {}));
  });
  await waitFor(() => expect((screen.getAllByRole("button", { name: /^Redo/ })[0] as HTMLButtonElement).disabled).toBe(true));
  for (const button of screen.getAllByRole("button", { name: /^Rewind to before this/ })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(WAIT);
  }
  page.stop();
});

test("the chat offers Undo this turn under the newest turn that changed files only", async () => {
  const { fake, page } = setup(THREE, "turn", "transcript");
  fake.raw.changesRevert.mockResolvedValue(REVERTED);
  const links = await screen.findAllByRole("button", { name: "Undo this turn" });
  expect(links).toHaveLength(1);
  await userEvent.click(links[0]!);
  expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "run", runId: "r3" }, false);
  page.stop();
});

test("a rewound turn is muted in the chat and reads rewound, with a Redo", async () => {
  const events = [...THREE, changed(null, "u1", "src/fetch.py", { source: "revert", reverts: "c3" }), changed(null, "u2", "src/config.py", { source: "revert", reverts: "c4" })];
  const { fake, page } = setup(events, "turn", "transcript");
  fake.raw.changesRevert.mockResolvedValue(REVERTED);
  const line = await waitFor(() => {
    const found = document.querySelector("[data-rewound]");
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });
  expect(line.textContent).toContain("⟲ rewound · 2 files put back");
  expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
  await userEvent.click(within(line).getByRole("button", { name: "Redo" }));
  await waitFor(() => expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "change", changeId: "u1" }, false));
  expect(fake.raw.changesRevert).toHaveBeenCalledWith("a", { kind: "change", changeId: "u2" }, false);
  page.stop();
});
