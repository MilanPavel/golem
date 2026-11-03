import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

function Editing({ onAnswer, onCancelled }: { onAnswer: (d: string, a?: unknown) => void; onCancelled?: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <ApprovalCard
      tool={PENDING_SHELL}
      pending
      editing={editing}
      onEdit={(open) => {
        setEditing(open);
        if (!open) onCancelled?.();
      }}
      onAnswer={onAnswer}
    />
  );
}

const editor = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const allowButton = () => screen.getByRole("button", { name: /^Allow once/ }) as HTMLButtonElement;
const edit = (text: string) => fireEvent.change(editor(), { target: { value: text } });

test("the Edit button sits after Always and before Deny", () => {
  render(<ApprovalCard tool={PENDING_SHELL} pending onAnswer={() => {}} />);
  const names = screen.getAllByRole("button").map((b) => b.textContent);
  expect(names).toEqual(["Allow once↵", "For this sessionS", "AlwaysW", "EditE", "DenyD"]);
  const button = screen.getByRole("button", { name: /^Edit/ });
  expect(button.getAttribute("data-action")).toBe("edit");
  expect(button.getAttribute("aria-keyshortcuts")).toBe("E");
});

test("Edit opens the arguments as JSON, labelled, focused, with the caret at the end", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  const field = screen.getByLabelText("Arguments, as JSON. Allow runs the edited call once.") as HTMLTextAreaElement;
  expect(field).toBe(editor());
  expect(field.value).toBe(JSON.stringify(PENDING_SHELL.args, null, 2));
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(field.value.length);
  expect(field.getAttribute("spellcheck")).toBe("false");
  expect(field.getAttribute("autocapitalize")).toBe("off");
  expect(document.querySelector("pre")).toBeNull();
  expect(screen.queryByRole("button", { name: /^(For this session|Always|Edit)/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Cancel/ }).getAttribute("aria-keyshortcuts")).toBe("Escape");
  expect(allowButton().getAttribute("aria-keyshortcuts")).toBe("Meta+Enter Control+Enter");
});

test("the diff and its switch are hidden while editing", () => {
  render(<ApprovalCard tool={PENDING_EDIT} pending editing onAnswer={() => {}} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("group", { name: "Diff layout" })).toBeNull();
  expect(editor().value).toBe(JSON.stringify(PENDING_EDIT.args, null, 2));
});

test("Cancel and Escape return to the card, send nothing, and focus Edit", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  for (const close of [
    () => fireEvent.click(screen.getByRole("button", { name: /^Cancel/ })),
    () => fireEvent.keyDown(editor(), { key: "Escape" }),
  ]) {
    fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
    edit('{"command": "changed"}');
    close();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("pre")?.textContent).toContain("pnpm --filter");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Edit/ }));
  }
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  expect(editor().value).toBe(JSON.stringify(PENDING_SHELL.args, null, 2));
  expect(onAnswer).not.toHaveBeenCalled();
});

test("Escape in the editor does not reach the page", () => {
  const onPage = vi.fn();
  document.addEventListener("keydown", onPage);
  render(<Editing onAnswer={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  fireEvent.keyDown(editor(), { key: "Escape" });
  document.removeEventListener("keydown", onPage);
  expect(onPage).not.toHaveBeenCalled();
});

test("Allow once sends the edited arguments; unchanged arguments send a plain allow", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  fireEvent.click(allowButton());
  expect(onAnswer).toHaveBeenLastCalledWith("allow");
  expect(onAnswer.mock.calls[0]).toHaveLength(1);
  edit('{"command": "ls"}');
  fireEvent.click(allowButton());
  expect(onAnswer).toHaveBeenLastCalledWith("allow", { command: "ls" });
});

test("Deny works from the editor", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Deny/ }));
  expect(onAnswer).toHaveBeenCalledWith("deny");
});

test("invalid JSON or a non-object disables Allow and says why; fixing it enables Allow", () => {
  render(<Editing onAnswer={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(editor().getAttribute("aria-invalid")).toBeNull();
  const cases: [string, string][] = [
    ['{"command": ', "not JSON: "],
    ["[]", "the arguments must be one JSON object"],
    ["1", "the arguments must be one JSON object"],
  ];
  for (const [text, reason] of cases) {
    edit(text);
    expect(allowButton().disabled).toBe(true);
    const why = screen.getByRole("status");
    expect(why.textContent).toContain(reason);
    expect(editor().getAttribute("aria-invalid")).toBe("true");
    expect(editor().getAttribute("aria-describedby")).toBe(why.id);
  }
  edit('{"command": "ls"}');
  expect(allowButton().disabled).toBe(false);
  expect(screen.queryByRole("status")).toBeNull();
  expect(editor().getAttribute("aria-invalid")).toBeNull();
});

test("Cmd+Enter and Ctrl+Enter allow when valid; plain Enter does not; invalid never does", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
  edit('{"command": "ls"}');
  fireEvent.keyDown(editor(), { key: "Enter" });
  expect(onAnswer).not.toHaveBeenCalled();
  fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
  expect(onAnswer).toHaveBeenLastCalledWith("allow", { command: "ls" });
  fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
  expect(onAnswer).toHaveBeenCalledTimes(2);
  edit("{");
  fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
  expect(onAnswer).toHaveBeenCalledTimes(2);
});

test("while sending, the editor is read-only and every button is disabled", () => {
  render(<ApprovalCard tool={PENDING_SHELL} pending editing sending onAnswer={() => {}} />);
  expect(editor().readOnly).toBe(true);
  for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
});
