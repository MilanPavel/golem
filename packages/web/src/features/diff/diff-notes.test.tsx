import { addNote, editNote, notesFor, removeNote, type NotesState } from "@golem/view";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import type { DiffMode } from "./diff-mode.ts";
import { expectAxeClean } from "../../gallery/gallery-test-utils.ts";
import { DiffView } from "./diff-view.tsx";
import { SAMPLE_EDIT_DIFF } from "./sample.ts";

function Noted({ mode = "unified" }: { mode?: DiffMode }) {
  const [state, setState] = useState<NotesState>({ notes: [], next: 1 });
  return (
    <DiffView
      diff={SAMPLE_EDIT_DIFF}
      mode={mode}
      notes={{
        notes: notesFor(state, "src/socket.ts"),
        onAddNote: (line, text) => {
          setState((s) => addNote(s, { ...line, text }));
        },
        onEditNote: (id, text) => {
          setState((s) => editNote(s, id, text));
        },
        onRemoveNote: (id) => {
          setState((s) => removeNote(s, id));
        },
      }}
    />
  );
}

test("a diff without the note props has no note buttons", () => {
  render(<DiffView diff={SAMPLE_EDIT_DIFF} mode="unified" />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("a note is added, edited and removed through the table", async () => {
  const user = userEvent.setup();
  render(<Noted />);
  await user.click(screen.getByRole("button", { name: "Add a note on line 2" }));
  await user.type(screen.getByRole("textbox", { name: "Note on line 2" }), "Why a new import?");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const saved = screen.getByRole("group", { name: "Note on line 2" });
  expect(saved.textContent).toContain("Why a new import?");
  // The note sits directly under its row.
  expect(screen.getByText('import { clamp } from "./clamp";').closest("tr")?.nextElementSibling?.contains(saved)).toBe(true);

  await user.click(screen.getByRole("button", { name: "Edit the note on line 2" }));
  const edit = screen.getByRole("textbox", { name: "Edit the note on line 2" });
  await user.clear(edit);
  await user.type(edit, "Use the helper.");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("group", { name: "Note on line 2" }).textContent).toContain("Use the helper.");

  await user.click(screen.getByRole("button", { name: "Remove the note on line 2" }));
  expect(screen.queryByRole("group", { name: "Note on line 2" })).toBeNull();
});

test("Escape cancels the box, and a blank note cannot be saved", async () => {
  const user = userEvent.setup();
  render(<Noted />);
  await user.click(screen.getByRole("button", { name: "Add a note on line 1" }));
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("the first row's button takes Tab, and a deleted line is noted by its old number", async () => {
  const user = userEvent.setup();
  render(<Noted />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a note on line 1" }));
  await user.click(screen.getByRole("button", { name: "Add a note on removed line 4" }));
  await user.type(screen.getByRole("textbox"), "gone?");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const row = screen.getByText("const delay = Math.min(Math.max(attempt, 0), 8);", { exact: false }).closest("tr");
  expect(row?.dataset["row"]).toBe("del");
  expect(row?.nextElementSibling?.textContent).toContain("gone?");
});

test("the split layout hides the note buttons", () => {
  render(<Noted mode="split" />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("the table with a saved note and an open box passes axe", async () => {
  const user = userEvent.setup();
  const { container } = render(<Noted />);
  await user.click(screen.getByRole("button", { name: "Add a note on line 2" }));
  await user.type(screen.getByRole("textbox"), "one");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Add a note on line 1" }));
  await expectAxeClean(container);
});
