import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import type { SessionSummary } from "../../store/session-list.ts";
import { SessionsPanel } from "./sessions-panel.tsx";
import { SHOW_HELPERS_KEY, showHelpersStore } from "./show-helpers.ts";

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

function setup(
  sessions: SessionSummary[] = SESSIONS,
  actions = { rename: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) },
  selectedId = "a",
  openHelperId: string | null = null,
) {
  const onNavigate = vi.fn();
  const view = render(
    <SessionsPanel sessions={sessions} selectedId={selectedId} openHelperId={openHelperId} now={NOW} onNavigate={onNavigate} actions={actions} />,
  );
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
  // The filter, the list options, the row's link, then its button.
  await user.tab();
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
  expect(label.className).toContain("text-meta");
  expect(label.className).toContain("text-faint");
  expect(screen.getByText("golem").className).toContain("font-mono");
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

const helper = (id: string, lead: string, status: SessionSummary["status"], extra: Partial<SessionSummary> = {}) =>
  session(id, `explorer · ${id}`, "/Users/you/repos/golem", at(0, 10), { status, parent_session_id: lead, agent: "explorer", ...extra });
const LEAD = session("lead", "The lead", "/Users/you/repos/golem", at(0, 11), { status: "running" });
const squaresOf = (container: HTMLElement) => [...container.querySelectorAll("[data-square]")].map((node) => node.getAttribute("data-square"));

test("a lead with two helpers is one row with two squares while another chat is open", () => {
  const { container } = setup([LEAD, helper("h1", "lead", "running"), helper("h2", "lead", "running"), session("o", "Other", null, at(0, 9))], undefined, "o");
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(container.querySelector("[data-helper-row]")).toBeNull();
  expect(squaresOf(container)).toEqual(["working", "working"]);
  expect(screen.getByTestId("helper-squares").getAttribute("title")).toBe("2 helpers working");
  expect(screen.getByText("2 helpers working").className).toContain("sr-only");
});

const helperRows = (container: HTMLElement) => [...container.querySelectorAll("[data-helper-row]")];

test("the open lead shows its two helpers as rows under it, and no squares", () => {
  const { container } = setup([LEAD, helper("h1", "lead", "running", { title: "explorer · Map approvals" }), helper("h2", "lead", "idle")], undefined, "lead");
  expect(helperRows(container).map((row) => row.getAttribute("data-helper-row"))).toEqual(["working", "done"]);
  expect(container.querySelector("[data-testid=helper-squares]")).toBeNull();
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(3);
  expect(links[1]!.textContent).toContain("explorer · Map approvals");
  expect(links[1]!.textContent).not.toContain("golem");
  expect(links[1]!.querySelector("time")).toBeNull();
  expect(helperRows(container)[0]!.className).toContain("ml-4");
  expect(helperRows(container)[0]!.getAttribute("aria-level")).toBe("2");
  expect(screen.getAllByText("helper of The lead")).toHaveLength(2);
});

test("a helper that is open keeps its lead's helpers shown, and is the current row", () => {
  const { container } = setup([LEAD, helper("h1", "lead", "running"), helper("h2", "lead", "running")], undefined, "lead", "h2");
  expect(helperRows(container)).toHaveLength(2);
  const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") !== null);
  expect(current).toHaveLength(1);
  expect(current[0]!.textContent).toContain("h2");
});

test("a helper row opens that helper", async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  const sessions = [LEAD, helper("h1", "lead", "running")];
  const onNavigate = vi.fn();
  render(<SessionsPanel sessions={sessions} selectedId="lead" now={NOW} onNavigate={onNavigate} helperActions={{ open, stop: vi.fn(), answer: vi.fn() }} />);
  await user.click(screen.getByRole("link", { name: /explorer · h1/ }));
  expect(open).toHaveBeenCalledWith("lead", "h1");
});

test("a helper the daemon has trimmed is not a row, and one with the field empty is", () => {
  const trimmed = helper("h1", "lead", "idle") as SessionSummary & { trimmed_at?: string | null };
  trimmed.trimmed_at = at(0, 10);
  const { container } = setup([LEAD, trimmed, helper("h2", "lead", "idle", {})], undefined, "lead");
  expect(helperRows(container)).toHaveLength(1);
  expect(screen.queryByText(/explorer · h1/)).toBeNull();
});

test("a fork has the grey tag and a helper never has it", () => {
  const fork = session("f", "The fork", "/Users/you/repos/golem", at(0, 8), { forked_from: "lead" });
  setup([LEAD, helper("h1", "lead", "running"), fork], undefined, "lead");
  expect(screen.getAllByTestId("fork-tag")).toHaveLength(1);
  expect(screen.getByTestId("fork-tag").textContent).toBe("fork");
  expect(screen.getByRole("link", { name: /explorer · h1/ }).textContent).not.toContain("fork");
});

test("the open lead with helpers has no accessibility violations", async () => {
  const { container } = setup([LEAD, helper("h1", "lead", "running"), helper("h2", "lead", "waiting")], undefined, "lead");
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(result.violations).toEqual([]);
});

test("a helper that asks has the wait colour, a queued one the hollow ring", () => {
  const { container } = setup([LEAD, helper("h1", "lead", "waiting"), helper("h2", "lead", "running", { wait_reason: "slot" })]);
  expect(squaresOf(container)).toEqual(["asking", "queued"]);
  expect(container.querySelector("[data-square=asking]")!.className).toContain("bg-wait");
  expect(container.querySelector("[data-square=queued]")!.className).toContain("border-clay");
  expect(screen.getByTestId("helper-squares").getAttribute("title")).toBe("1 helper queued, 1 helper asks you");
});

test("helpers that are done leave no squares, and a helper without its lead is no row", () => {
  const { container } = setup([LEAD, helper("h1", "lead", "idle"), helper("h2", "gone", "running")]);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(container.querySelector("[data-testid=helper-squares]")).toBeNull();
});

test("the filter does not find helpers", async () => {
  const user = userEvent.setup();
  setup([LEAD, helper("h1", "lead", "running")], undefined, "lead");
  await user.type(screen.getByRole("textbox", { name: "Filter sessions" }), "explorer");
  expect(screen.getByText("No sessions match.")).toBeTruthy();
});

test("an older daemon, with no parent_session_id, shows the list as before", () => {
  const { container } = setup([LEAD, session("o", "Other", null, at(0, 9))]);
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(container.querySelector("[data-testid=helper-squares]")).toBeNull();
});

test("Show helpers is off by default, nests the helpers of every lead, and is kept", async () => {
  const user = userEvent.setup();
  localStorage.clear();
  showHelpersStore.set(false);
  const other = session("o", "Other lead", "/Users/you/repos/golem", at(0, 9));
  const { container } = setup([LEAD, helper("h1", "lead", "running"), other, helper("o1", "o", "idle")], undefined, "a");
  expect(helperRows(container)).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "List options" }));
  const item = screen.getByRole("menuitemcheckbox", { name: "Show helpers" });
  expect(item.getAttribute("aria-checked")).toBe("false");
  await user.click(item);
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(helperRows(container).map((row) => row.getAttribute("data-helper-row"))).toEqual(["working", "done"]);
  expect(localStorage.getItem(SHOW_HELPERS_KEY)).toBe("1");
  await user.type(screen.getByRole("textbox", { name: "Filter sessions" }), "explorer · o1");
  expect(screen.getAllByRole("link")).toHaveLength(2);
  showHelpersStore.set(false);
  localStorage.clear();
});
