import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import type { SessionSummary } from "../../store/session-list.ts";
import { SessionsPanel } from "./sessions-panel.tsx";
import type { HelperCardActions } from "./helper-row-card.tsx";

const NOW = new Date(2026, 10, 17, 12, 0).getTime();
const AT = new Date(2026, 10, 17, 11, 58).toISOString();
const STARTED = new Date(2026, 10, 17, 11, 57).toISOString();

function s(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { session_id: id, created_at: AT, updated_at: AT, last_seq: 1, model_profile: "default", status: "idle", cwd: "/Users/you/repos/golem", title: id, ...extra };
}

function helper(id: string, label: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return s(id, { parent_session_id: "lead", agent: "explorer", title: `explorer · ${label}`, status: "running", created_at: STARTED, ...extra });
}

const LEAD = s("lead", { title: "Map the daemon", status: "running" });
const HELPERS = [
  helper("h1", "the daemon modules", { step: "read daemon/app.py" }),
  helper("h2", "the client", { step: "grep connect" }),
  helper("h3", "the retry code", {
    status: "waiting",
    step: "write notes/retry.md",
    pending: { kind: "approval", since: AT, call_id: "c9", name: "write_file", subject: "notes/retry.md" },
  }),
  helper("h4", "the ADRs", { wait_reason: "slot", wait_line: "qwen3:14b" }),
];

function setup(sessions: SessionSummary[] = [LEAD, ...HELPERS]) {
  const onNavigate = vi.fn();
  const helperActions: HelperCardActions = {
    open: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
  };
  const view = render(<SessionsPanel sessions={sessions} selectedId={null} now={NOW} onNavigate={onNavigate} helperActions={helperActions} />);
  return { ...view, onNavigate, helperActions };
}

const card = () => screen.queryByRole("dialog", { name: "Helpers of Map the daemon" });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("hovering the row opens the card: head, one block for each helper, the newest step, working time", async () => {
  const user = userEvent.setup();
  setup();
  expect(card()).toBeNull();
  await user.hover(screen.getByRole("link", { name: /Map the daemon/ }));
  const inside = within(await screen.findByRole("dialog", { name: "Helpers of Map the daemon" }));
  expect(inside.getByText("4 helpers · 1 asks you")).toBeTruthy();
  const blocks = document.querySelectorAll("[data-helper-block]");
  expect([...blocks].map((b) => b.getAttribute("data-helper-block"))).toEqual(["working", "working", "asking", "queued"]);
  expect(inside.getByText("the daemon modules")).toBeTruthy();
  expect(inside.getByText("read daemon/app.py")).toBeTruthy();
  expect(inside.getAllByText(/^3m 0\ds$/)).toHaveLength(4);
  // The asking one shows its question and the answer buttons; the others have none.
  expect(inside.getByText("Write retry.md")).toBeTruthy();
  expect(inside.getAllByRole("button", { name: /^Allow once/ })).toHaveLength(1);
  // The list did not grow: still one row.
  expect(screen.getAllByRole("link")).toHaveLength(1);
});

test("Open and Stop call what they should for that helper", async () => {
  const user = userEvent.setup();
  const { helperActions } = setup();
  await user.hover(screen.getByRole("link", { name: /Map the daemon/ }));
  const inside = within(await screen.findByRole("dialog", { name: "Helpers of Map the daemon" }));
  await user.click(inside.getByRole("button", { name: "Open explorer the client" }));
  expect(helperActions.open).toHaveBeenCalledWith("lead", "h2");
  await user.click(inside.getByRole("button", { name: "Stop explorer the daemon modules" }));
  expect(helperActions.stop).toHaveBeenCalledWith("h1");
  await user.click(inside.getByRole("button", { name: "Allow once, explorer the retry code" }));
  expect(helperActions.answer).toHaveBeenCalledWith("h3", "c9", "allow");
});

test("a failed Stop leaves a line in the block", async () => {
  const user = userEvent.setup();
  const { helperActions } = setup();
  vi.mocked(helperActions.stop).mockRejectedValueOnce(new Error("gone"));
  await user.hover(screen.getByRole("link", { name: /Map the daemon/ }));
  const inside = within(await screen.findByRole("dialog", { name: "Helpers of Map the daemon" }));
  await user.click(inside.getByRole("button", { name: "Stop explorer the client" }));
  expect(await inside.findByRole("alert")).toBeTruthy();
});

test("no card when no helper is running or waiting", async () => {
  const user = userEvent.setup();
  setup([LEAD, helper("h1", "done one", { status: "idle" })]);
  await user.hover(screen.getByRole("link", { name: /Map the daemon/ }));
  await pause(300);
  expect(card()).toBeNull();
});

test("an older daemon with no parent_session_id or step shows no card and nothing breaks", async () => {
  const user = userEvent.setup();
  setup([LEAD, s("old", { status: "running", title: "Old helper" })]);
  await user.hover(screen.getByRole("link", { name: /Map the daemon/ }));
  await pause(300);
  expect(card()).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(2);
});

test("keyboard: right arrow on the row opens the card and takes focus, Esc closes it and gives focus back", async () => {
  const user = userEvent.setup();
  setup();
  const row = screen.getByRole("link", { name: /Map the daemon/ });
  row.focus();
  await user.keyboard("{ArrowRight}");
  const dialog = await screen.findByRole("dialog", { name: "Helpers of Map the daemon" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Tab}");
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(row);
});

test("keyboard: Shift+Tab from the first button leaves the card and returns to the row", async () => {
  const user = userEvent.setup();
  setup();
  const row = screen.getByRole("link", { name: /Map the daemon/ });
  row.focus();
  await user.keyboard("{ArrowRight}");
  await screen.findByRole("dialog", { name: "Helpers of Map the daemon" });
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(row);
});

test("a tap on the squares opens the card and does not open the chat; the rest of the row still does", async () => {
  const user = userEvent.setup();
  const { onNavigate } = setup();
  await user.click(screen.getByTestId("helper-squares"));
  expect(await screen.findByRole("dialog", { name: "Helpers of Map the daemon" })).toBeTruthy();
  expect(onNavigate).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  fireEvent.click(screen.getByText("Map the daemon"));
  expect(onNavigate).toHaveBeenCalledWith("/s/lead");
});

test("the open card passes axe", async () => {
  const user = userEvent.setup();
  setup();
  await user.hover(screen.getByRole("link", { name: /Map the daemon/ }));
  await screen.findByRole("dialog", { name: "Helpers of Map the daemon" });
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
});
