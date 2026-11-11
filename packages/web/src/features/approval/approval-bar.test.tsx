import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { diffModeStore } from "../diff/diff-mode.ts";
import { ApprovalBar } from "./approval-bar.tsx";
import { PENDING_EDIT, PENDING_SHELL } from "./sample.ts";

beforeEach(() => {
  diffModeStore.set("unified");
});

/** Opens Details when it is closed, then Edit args. */
function openEditor(): void {
  const details = screen.getByRole("button", { name: "Details" });
  if (details.getAttribute("aria-expanded") === "false") fireEvent.click(details);
  fireEvent.click(screen.getByRole("button", { name: /^Edit args/ }));
}

test("a pending edit asks the question, says who asked, and shows the diff open", () => {
  render(<ApprovalBar tool={PENDING_EDIT} onAnswer={() => {}} />);
  const bar = screen.getByRole("group", { name: "Approval" });
  expect(bar.querySelector("p")?.textContent).toBe("Allow edit_file on socket.ts?");
  expect(bar.querySelector("[title='src/socket.ts']")?.textContent).toBe("socket.ts");
  expect(bar.textContent).toContain("asks: built-in default");
  expect(screen.getByRole("table", { name: "Change to src/socket.ts" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Diff layout" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("true");
});

test("an MCP tool reads server and tool, and a call without arguments has no target", () => {
  const tool = { ...PENDING_SHELL, name: "mcp__github__get_me", args: {}, approval: { source: "built-in default (balanced)", subject: null } };
  render(<ApprovalBar tool={tool} onAnswer={() => {}} />);
  const bar = screen.getByRole("group", { name: "Approval" });
  expect(bar.querySelector("p")?.textContent).toBe("Allow github · get_me?");
  expect(bar.textContent).toContain("asks: built-in default (balanced)");
});

test("the buttons are Allow once, Allow in this chat with its menu, Details, and Deny", () => {
  render(<ApprovalBar tool={PENDING_SHELL} onAnswer={() => {}} />);
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow once↵", "Allow in this chatS", "▾", "Details", "DenyD"]);
  expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false");
});

test("each button answers with its decision, and the menu offers always", async () => {
  const onAnswer = vi.fn();
  render(<ApprovalBar tool={PENDING_EDIT} onAnswer={onAnswer} />);
  const buttons: [string, string, string][] = [
    ["Allow once", "allow", "Enter"],
    ["Allow in this chat", "allow_session", "S"],
    ["Deny", "deny", "D"],
  ];
  for (const [name, decision, shortcut] of buttons) {
    const button = screen.getByRole("button", { name: new RegExp(`^${name}`) });
    expect(button.getAttribute("data-decision")).toBe(decision);
    expect(button.getAttribute("aria-keyshortcuts")).toBe(shortcut);
    fireEvent.click(button);
    expect(onAnswer).toHaveBeenLastCalledWith(decision);
  }
  const more = screen.getByRole("button", { name: "More ways to allow" });
  fireEvent.keyDown(more, { key: "Enter" });
  const menu = await screen.findByRole("menu");
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["Always allow edit_fileW"]);
  expect(items[0]?.getAttribute("data-decision")).toBe("allow_always");
  expect(items[0]?.getAttribute("aria-keyshortcuts")).toBe("W");
  fireEvent.keyDown(items[0] as HTMLElement, { key: "Enter" });
  expect(onAnswer).toHaveBeenLastCalledWith("allow_always");
  expect(onAnswer).toHaveBeenCalledTimes(4);
});

test("the buttons are disabled while an answer is sending", () => {
  render(<ApprovalBar tool={PENDING_EDIT} sending onAnswer={() => {}} />);
  for (const decision of ["allow", "allow_session", "deny"]) {
    expect((document.querySelector(`[data-decision=${decision}]`) as HTMLButtonElement).disabled).toBe(true);
  }
  expect((screen.getByRole("button", { name: "More ways to allow" }) as HTMLButtonElement).disabled).toBe(true);
});

test("an error shows as an alert under the actions", () => {
  render(<ApprovalBar tool={PENDING_EDIT} error="The daemon refused." onAnswer={() => {}} />);
  expect(screen.getByRole("alert").textContent).toBe("The daemon refused.");
});

test("a shell call has no diff; Details opens its arguments and Edit args", () => {
  render(<ApprovalBar tool={PENDING_SHELL} onAnswer={() => {}} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(document.querySelector("pre")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Edit args/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(document.querySelector("pre")?.textContent).toContain("pnpm --filter @golem/web test && just check");
  expect(screen.queryByRole("group", { name: "Diff layout" })).toBeNull();
  const edit = screen.getByRole("button", { name: /^Edit args/ });
  expect(edit.getAttribute("data-action")).toBe("edit");
  expect(edit.getAttribute("aria-keyshortcuts")).toBe("E");
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(document.querySelector("pre")).toBeNull();
});

function Editing({ onAnswer, onCancelled }: { onAnswer: (d: string, a?: unknown) => void; onCancelled?: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <ApprovalBar
      tool={PENDING_SHELL}
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

test("Edit opens the arguments as JSON, labelled, focused, with the caret at the end", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  openEditor();
  const field = screen.getByLabelText("Arguments, as JSON. Allow runs the edited call once.") as HTMLTextAreaElement;
  expect(field).toBe(editor());
  expect(field.value).toBe(JSON.stringify(PENDING_SHELL.args, null, 2));
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(field.value.length);
  expect(field.getAttribute("spellcheck")).toBe("false");
  expect(field.getAttribute("autocapitalize")).toBe("off");
  expect(document.querySelector("pre")).toBeNull();
  expect(screen.queryByRole("button", { name: /^(Allow in this chat|Details|Edit)/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Cancel/ }).getAttribute("aria-keyshortcuts")).toBe("Escape");
  expect(allowButton().getAttribute("aria-keyshortcuts")).toBe("Meta+Enter Control+Enter");
});

test("the diff and its switch are hidden while editing", () => {
  render(<ApprovalBar tool={PENDING_EDIT} editing onAnswer={() => {}} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("group", { name: "Diff layout" })).toBeNull();
  expect(editor().value).toBe(JSON.stringify(PENDING_EDIT.args, null, 2));
});

test("Cancel and Escape return to the bar, send nothing, and focus Details", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  for (const close of [
    () => fireEvent.click(screen.getByRole("button", { name: /^Cancel/ })),
    () => fireEvent.keyDown(editor(), { key: "Escape" }),
  ]) {
    openEditor();
    edit('{"command": "changed"}');
    close();
    expect(screen.queryByRole("textbox")).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Details" }));
  }
  openEditor();
  expect(editor().value).toBe(JSON.stringify(PENDING_SHELL.args, null, 2));
  expect(onAnswer).not.toHaveBeenCalled();
});

test("Escape in the editor does not reach the page", () => {
  const onPage = vi.fn();
  document.addEventListener("keydown", onPage);
  render(<Editing onAnswer={() => {}} />);
  openEditor();
  fireEvent.keyDown(editor(), { key: "Escape" });
  document.removeEventListener("keydown", onPage);
  expect(onPage).not.toHaveBeenCalled();
});

test("Allow once sends the edited arguments; unchanged arguments send a plain allow", () => {
  const onAnswer = vi.fn();
  render(<Editing onAnswer={onAnswer} />);
  openEditor();
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
  openEditor();
  fireEvent.click(screen.getByRole("button", { name: /^Deny/ }));
  expect(onAnswer).toHaveBeenCalledWith("deny");
});

test("invalid JSON or a non-object disables Allow and says why; fixing it enables Allow", () => {
  render(<Editing onAnswer={() => {}} />);
  openEditor();
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
  openEditor();
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
  render(<ApprovalBar tool={PENDING_SHELL} editing sending onAnswer={() => {}} />);
  expect(editor().readOnly).toBe(true);
  for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
});
