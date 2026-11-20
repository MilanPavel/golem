import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import type { SessionSummary } from "../../store/session-list.ts";
import { SessionsPanel } from "./sessions-panel.tsx";

const NOW = new Date(2026, 10, 17, 12, 0).getTime();
const at = (days: number, hour = 11) => new Date(2026, 10, 17 - days, hour, 0).toISOString();

function session(id: string, title: string | null, cwd: string | null, updated: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { session_id: id, created_at: updated, updated_at: updated, last_seq: 1, model_profile: "default", status: "idle", cwd, title, ...extra };
}

const SESSIONS: SessionSummary[] = [
  session("a", "Fix the socket", "/Users/you/repos/golem", at(0)),
  session("b", "Weekday digest", "/Users/you/notes", at(1), { origin: "routine:digest" }),
  session("c", "Older idea", "/Users/you/notes", at(3)),
  session("d", "Ancient work", null, at(30)),
  session("e", "Closed one", "/Users/you/notes", at(0), { status: "closed" }),
];

function setup(sessions: SessionSummary[] = SESSIONS, actions = { rename: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) }) {
  const onNavigate = vi.fn();
  const view = render(<SessionsPanel sessions={sessions} selectedId="a" now={NOW} onNavigate={onNavigate} actions={actions} />);
  return { ...view, actions, onNavigate };
}

const headings = (container: HTMLElement) =>
  [...container.querySelectorAll("ul")].map((list) => document.getElementById(list.getAttribute("aria-labelledby")!)?.textContent);

test("groups come in order with their headings, and closed sessions are left out", () => {
  const { container } = setup();
  expect(headings(container)).toEqual(["Today", "Yesterday", "Previous 7 days", "Earlier"]);
  expect(screen.queryByText("Closed one")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(4);
});

test("a group with no sessions is left out", () => {
  const { container } = setup([SESSIONS[0]!, SESSIONS[3]!]);
  expect(headings(container)).toEqual(["Today", "Earlier"]);
});

test("a fork sits under its parent, in the parent's group", () => {
  const sessions = [
    session("p", "Parent", "/x/y", at(0, 11)),
    session("f", "The fork", "/x/y", at(5), { forked_from: "p" }),
    session("o", "Other", "/x/y", at(0, 9)),
  ];
  const { container } = setup(sessions);
  expect(headings(container)).toEqual(["Today"]);
  const names = screen.getAllByRole("link").map((link) => link.textContent);
  expect(names[0]).toContain("Parent");
  expect(names[1]).toContain("The fork");
  expect(names[2]).toContain("Other");
  expect(screen.getByRole("link", { name: /fork of Parent/ })).toBeTruthy();
});

test("the filter narrows by title and by folder name, and Esc clears it", async () => {
  const user = userEvent.setup();
  setup();
  const field = screen.getByRole("textbox", { name: "Filter sessions" });
  await user.type(field, "SOCKET");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: /Fix the socket/ })).toBeTruthy();
  await user.clear(field);
  await user.type(field, "notes");
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    expect.stringContaining("Weekday digest"),
    expect.stringContaining("Older idea"),
  ]);
  await user.keyboard("{Escape}");
  expect((field as HTMLInputElement).value).toBe("");
  expect(screen.getAllByRole("link")).toHaveLength(4);
});

test("no match and no sessions say so", async () => {
  const user = userEvent.setup();
  const first = setup();
  await user.type(screen.getByRole("textbox", { name: "Filter sessions" }), "zzz");
  expect(screen.getByText("No sessions match.")).toBeTruthy();
  first.unmount();
  setup([]);
  expect(screen.getByText("No sessions yet.")).toBeTruthy();
});

test("the time is on the folder line and stays visible on hover and focus; the button is not beside it", async () => {
  const user = userEvent.setup();
  setup();
  const row = screen.getByRole("link", { name: /Fix the socket/ }).closest("li")!;
  const time = row.querySelector("time")!;
  const button = within(row).getByRole("button", { name: "Actions for Fix the socket" });
  expect(time.textContent).toBe("1h");
  // The folder name and the time are on one line, inside the link.
  expect(time.parentElement).toBe(screen.getByText("golem").parentElement!.parentElement);
  expect(row.querySelector("a")?.contains(time)).toBe(true);
  expect(time.className).toContain("ml-auto");
  expect(time.className).not.toContain("opacity-0");
  expect(time.parentElement?.contains(button)).toBe(false);
  expect(row.querySelector("[data-slot=row-end]")).toBeNull();
  // The title keeps room for the button only; the button shows on hover and focus.
  expect(screen.getByText("Fix the socket").parentElement?.className).toContain("pr-6");
  expect(button.className).toContain("group-hover:opacity-100");
  await user.hover(row);
  await user.tab();
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(button);
  expect(time.className).not.toContain("opacity-0");
});

test("a row with no folder still shows the time", () => {
  setup();
  const row = screen.getByRole("link", { name: /Ancient work/ }).closest("li")!;
  expect(row.querySelector("time")?.textContent).toBe("Oct 18");
  expect(row.querySelector("a svg")).toBeNull();
});

test("the folder icon is hidden from screen readers", () => {
  setup();
  const row = screen.getByRole("link", { name: /Fix the socket/ }).closest("li")!;
  const icon = screen.getByText("golem").previousElementSibling!;
  expect(icon.tagName.toLowerCase()).toBe("svg");
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  expect(row.querySelector("a")?.contains(icon)).toBe(true);
});

test("the menu button's tooltip is short, and its name still names the session", async () => {
  const user = userEvent.setup();
  setup();
  const button = screen.getByRole("button", { name: "Actions for Fix the socket" });
  await user.hover(button);
  expect((await screen.findByRole("tooltip")).textContent).toBe("More actions");
});

test("the folder shows as its basename, with the full path in the title; no folder shows none", () => {
  setup();
  const label = screen.getByText("golem").parentElement!;
  expect(label.getAttribute("title")).toBe("/Users/you/repos/golem");
  expect(label.className).toContain("font-mono");
  expect(label.className).toContain("text-xs");
  expect(label.className).toContain("text-faint");
  const none = screen.getByRole("link", { name: /Ancient work/ });
  expect(none.querySelector("[title]")).toBeNull();
});

test("a routine session shows a clock mark named for screen readers", () => {
  setup();
  expect(screen.getByRole("link", { name: /Weekday digest/ }).textContent).toContain("started by a routine");
  expect(screen.getByRole("link", { name: /Fix the socket/ }).textContent).not.toContain("started by a routine");
});

test("right-click opens the same menu as the button, with Rename and Close", () => {
  setup();
  const row = screen.getByRole("link", { name: /Older idea/ }).closest("li")!;
  const notPrevented = fireEvent.contextMenu(row);
  expect(notPrevented).toBe(false);
  expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Rename", "Close"]);
});

const dotOf = (name: RegExp) => screen.getByRole("link", { name }).querySelector("span.inline-flex")!;

test("the dot shows idle, running, waiting and queued, and queued reads its sentence from the wait", () => {
  setup([
    session("i", "Idle one", null, at(0)),
    session("r", "Running one", null, at(0), { status: "running" }),
    session("w", "Waiting one", null, at(0), { status: "waiting" }),
    session("q", "Queued one", null, at(0), { status: "running", wait_reason: "slot", wait_line: "qwen3:14b" }),
    session("p", "Provider one", null, at(0), { status: "running", wait_reason: "provider", wait_line: "anthropic" }),
  ]);
  expect(dotOf(/Idle one/).textContent).toBe("idle");
  expect(dotOf(/Running one/).textContent).toBe("running");
  expect(dotOf(/Waiting one/).textContent).toBe("waiting");
  expect(dotOf(/Queued one/).textContent).toBe("queued, waiting for qwen3:14b");
  expect(dotOf(/Queued one/).getAttribute("title")).toBe("waiting for qwen3:14b");
  expect(dotOf(/Provider one/).getAttribute("title")).toBe("anthropic is busy");
  expect(dotOf(/Provider one/).textContent).not.toMatch(/local/i);
  expect(dotOf(/Running one/).getAttribute("title")).toBeNull();
});

test("a summary from an older daemon, with no wait fields, shows the dot as before", () => {
  const old = session("o", "Old daemon", null, at(0), { status: "running" });
  expect("wait_reason" in old).toBe(false);
  setup([old]);
  expect(dotOf(/Old daemon/).textContent).toBe("running");
});

test("a wait on an idle or closed session is not queued", () => {
  setup([session("x", "Stale wait", null, at(0), { status: "idle", wait_reason: "slot", wait_line: "qwen3:14b" })]);
  expect(dotOf(/Stale wait/).textContent).toBe("idle");
});

test("the selected row is current, and the panel has no accessibility violations", async () => {
  const { container } = setup();
  expect(screen.getByRole("link", { name: /Fix the socket/ }).getAttribute("aria-current")).toBe("page");
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(result.violations).toEqual([]);
});
