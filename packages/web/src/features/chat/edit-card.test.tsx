import type { ChatMessage, ToolBlock } from "@golem/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SAMPLE_EDIT_DIFF, SAMPLE_NEW_FILE_DIFF } from "../diff/sample.ts";
import { tabStore, useRequestedChange } from "../workbench/workbench-state.ts";
import { EditCard } from "./edit-card.tsx";
import { TranscriptMessages } from "./transcript.tsx";

afterEach(() => {
  cleanup();
  act(() => {
    tabStore.set(null);
  });
});

const edit = (over: Partial<ToolBlock> = {}): ToolBlock => ({
  callId: "e1",
  name: "edit_file",
  args: { path: "src/socket.ts" },
  status: "done",
  summary: "+3 -3 src/socket.ts",
  diff: SAMPLE_EDIT_DIFF,
  ...over,
});

function Requested() {
  const [path] = useRequestedChange();
  return <p data-testid="requested">{path ?? "none"}</p>;
}

const turn = (tools: ToolBlock[]): { messages: ChatMessage[]; error: null; notice: null } => ({
  messages: [
    { id: "u", role: "user", text: "go", streaming: false },
    { id: "a", role: "assistant", text: "Done", streaming: false, tools },
  ],
  error: null,
  notice: null,
});

test("the card shows the path and the counts from the diff", () => {
  render(<EditCard tool={edit()} />);
  const card = screen.getByRole("button", { name: "Show the change to src/socket.ts" });
  expect(card.textContent).toContain("src/socket.ts");
  expect(card.textContent).toContain("+3");
  expect(card.textContent).toContain("−3");
  expect(card.textContent).not.toContain("new");
});

test("a new file shows the plus sign and a new badge", () => {
  render(<EditCard tool={edit({ name: "write_file", args: { path: "src/clamp.ts" }, diff: SAMPLE_NEW_FILE_DIFF })} />);
  const card = screen.getByRole("button", { name: "Show the change to src/clamp.ts" });
  expect(card.textContent).toContain("＋");
  expect(card.textContent).toContain("new");
});

test("a click asks the panel to open the file", () => {
  render(
    <>
      <EditCard tool={edit()} />
      <Requested />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show the change to src/socket.ts" }));
  expect(screen.getByTestId("requested").textContent).toBe("src/socket.ts");
  expect(tabStore.getSnapshot()).toBe("changes");
});

test("the chevron opens the diff below the card and closes it again", () => {
  render(<EditCard tool={edit()} />);
  expect(screen.queryByRole("table")).toBeNull();
  const chevron = screen.getByRole("button", { name: "Show the diff of src/socket.ts here" });
  fireEvent.click(chevron);
  expect(screen.getByRole("table", { name: "Change to src/socket.ts" })).toBeTruthy();
  fireEvent.click(chevron);
  expect(screen.queryByRole("table")).toBeNull();
});

test("a call with no diff shows the card without counts or chevron", () => {
  render(<EditCard tool={{ callId: "e1", name: "edit_file", args: { path: "src/socket.ts" }, status: "done" }} />);
  const card = screen.getByRole("button", { name: "Show the change to src/socket.ts" });
  expect(card.textContent).not.toMatch(/[+−]\d/);
  expect(screen.queryByRole("button", { name: /Show the diff/ })).toBeNull();
});

test("three edits are three cards", () => {
  render(
    <TranscriptMessages
      chat={turn([
        edit({ callId: "1", args: { path: "a.ts" } }),
        edit({ callId: "2", args: { path: "b.ts" } }),
        edit({ callId: "3", args: { path: "c.ts" } }),
      ])}
      detail="normal"
    />,
  );
  expect(screen.getAllByRole("button", { name: /^Show the change to / })).toHaveLength(3);
});

test("a failed edit keeps the old tool line", () => {
  render(<TranscriptMessages chat={turn([edit({ status: "failed", error: "no such file" })])} detail="verbose" />);
  expect(screen.queryByRole("button", { name: /^Show the change to / })).toBeNull();
  expect(screen.getByRole("button", { name: /edit_file/ })).toBeTruthy();
});

test("a call that ran but did not succeed keeps the old tool line", () => {
  render(<TranscriptMessages chat={turn([edit({ unsuccessful: true })])} detail="verbose" />);
  expect(screen.queryByRole("button", { name: /^Show the change to / })).toBeNull();
});

test("quiet detail hides the cards and keeps the activity line", () => {
  render(<TranscriptMessages chat={turn([edit()])} detail="quiet" />);
  expect(screen.queryByRole("button", { name: /^Show the change to / })).toBeNull();
  expect(screen.getByRole("button", { name: /1 step/ })).toBeTruthy();
});
