import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { diffModeStore } from "../diff/diff-mode.ts";
import { ApprovalCard } from "./approval-card.tsx";
import { ANSWERED, PENDING_EDIT, PENDING_SHELL } from "./sample.ts";

beforeEach(() => {
  diffModeStore.set("unified");
});

test("a pending edit asks the question, names the rule, and shows the diff and the switch", () => {
  render(<ApprovalCard tool={PENDING_EDIT} pending onAnswer={() => {}} />);
  const card = screen.getByRole("group", { name: "Approval" });
  expect(card.querySelector("h2")?.textContent).toBe("Allow edit_file on socket.ts?");
  expect(card.querySelector("[title='src/socket.ts']")?.textContent).toBe("socket.ts");
  expect(card.textContent).toContain("rule: edit_file → ask · built-in default");
  expect(screen.getByRole("table", { name: "Change to src/socket.ts" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Diff layout" })).toBeTruthy();
});

test("each button answers with its decision", () => {
  const onAnswer = vi.fn();
  render(<ApprovalCard tool={PENDING_EDIT} pending onAnswer={onAnswer} />);
  const buttons: [string, string, string][] = [
    ["Allow once", "allow", "Enter"],
    ["For this session", "allow_session", "S"],
    ["Always", "allow_always", "W"],
    ["Deny", "deny", "D"],
  ];
  for (const [name, decision, shortcut] of buttons) {
    const button = screen.getByRole("button", { name: new RegExp(`^${name}`) });
    expect(button.getAttribute("data-decision")).toBe(decision);
    expect(button.getAttribute("aria-keyshortcuts")).toBe(shortcut);
    fireEvent.click(button);
    expect(onAnswer).toHaveBeenLastCalledWith(decision);
  }
  expect(onAnswer).toHaveBeenCalledTimes(4);
});

test("the buttons are disabled while an answer is sending", () => {
  render(<ApprovalCard tool={PENDING_EDIT} pending sending onAnswer={() => {}} />);
  for (const decision of ["allow", "allow_session", "allow_always", "deny"]) {
    expect((document.querySelector(`[data-decision=${decision}]`) as HTMLButtonElement).disabled).toBe(true);
  }
});

test("an error shows as an alert under the actions", () => {
  render(<ApprovalCard tool={PENDING_EDIT} pending error="The daemon refused." onAnswer={() => {}} />);
  expect(screen.getByRole("alert").textContent).toBe("The daemon refused.");
});

test("a shell call has no diff and shows its arguments", () => {
  render(<ApprovalCard tool={PENDING_SHELL} pending onAnswer={() => {}} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("group", { name: "Diff layout" })).toBeNull();
  expect(document.querySelector("pre")?.textContent).toContain("pnpm --filter @golem/web test && just check");
});

test("an answered card is one line, with no diff, actions, or switch", () => {
  const lines: Record<string, string> = {
    "Allowed once": "✓ Allowed once",
    "Allowed for this session": "✓ Allowed for this session",
    "Always allowed, with a rule": "✓ Always allowed, rule edit_file(src/**) → allow",
    Denied: "✗ Denied",
  };
  for (const [label, line] of Object.entries(lines)) {
    const tool = ANSWERED.find((item) => item.label === label)!.tool;
    const { container, unmount } = render(<ApprovalCard tool={tool} pending={false} onAnswer={() => {}} />);
    expect(container.textContent).toContain(line);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector(".shadow-soft")).toBeNull();
    unmount();
  }
});

test("an edited allow says so", () => {
  const tool = { ...PENDING_EDIT, approval: { source: "x", subject: null, answer: { decision: "allow" as const, rule: null, edited: true } } };
  const { container } = render(<ApprovalCard tool={tool} pending={false} onAnswer={() => {}} />);
  expect(container.textContent).toContain("✓ Allowed once, with edited arguments");
});

test("a card nobody answered says so", () => {
  const tool = ANSWERED.find((item) => item.label === "Not answered")!.tool;
  const { container } = render(<ApprovalCard tool={tool} pending={false} onAnswer={() => {}} />);
  expect(container.textContent).toContain("Not answered");
  expect(screen.queryByRole("button")).toBeNull();
});
