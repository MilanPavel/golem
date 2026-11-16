import { expect, test, vi } from "vitest";
import { createNotes } from "./notes.ts";

const note = (text: string) => ({ path: "a.ts", line: 3, side: "new" as const, code: "x", text });

test("notes are kept per session, and an empty session takes no room", () => {
  const notes = createNotes();
  notes.add("a", note("one"));
  notes.add("b", note("two"));
  expect(notes.get("a").notes.map((n) => n.text)).toEqual(["one"]);
  expect(notes.getSnapshot().size).toBe(2);
  notes.clear("a");
  expect(notes.get("a").notes).toEqual([]);
  expect(notes.getSnapshot().size).toBe(1);
});

test("edit, remove and drop change one session and tell the listeners", () => {
  const notes = createNotes();
  const listener = vi.fn();
  notes.subscribe(listener);
  notes.add("a", note("one"));
  notes.add("a", note("two"));
  const [first, second] = notes.get("a").notes;
  notes.edit("a", first!.id, "uno");
  expect(notes.get("a").notes[0]?.text).toBe("uno");
  notes.drop("a", [first!.id]);
  expect(notes.get("a").notes.map((n) => n.id)).toEqual([second!.id]);
  notes.remove("a", second!.id);
  expect(notes.get("a").notes).toEqual([]);
  expect(listener).toHaveBeenCalledTimes(5);
});
