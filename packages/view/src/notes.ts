/** Review notes on diff lines. They live in the client and become ordinary message text. */

export type ReviewNote = { id: string; path: string; line: number; side: "new" | "old"; code: string; text: string };

/** `next` is the counter the ids come from. */
export type NotesState = { notes: ReviewNote[]; next: number };

export const noNotes: NotesState = { notes: [], next: 1 };

const CODE_CHARS = 200;

export function addNote(state: NotesState, note: Omit<ReviewNote, "id">): NotesState {
  return { notes: [...state.notes, { ...note, id: `n${state.next}` }], next: state.next + 1 };
}

/** Empty text removes the note. */
export function editNote(state: NotesState, id: string, text: string): NotesState {
  if (text === "") {
    return removeNote(state, id);
  }
  return { ...state, notes: state.notes.map((note) => (note.id === id ? { ...note, text } : note)) };
}

export function removeNote(state: NotesState, id: string): NotesState {
  return { ...state, notes: state.notes.filter((note) => note.id !== id) };
}

/** The notes of one file, by line. */
export function notesFor(state: NotesState, path: string): ReviewNote[] {
  return state.notes.filter((note) => note.path === path).sort((a, b) => a.line - b.line);
}

export function notesChip(state: NotesState): string | null {
  const count = state.notes.length;
  if (count === 0) {
    return null;
  }
  return count === 1 ? "1 note" : `${count} notes`;
}

function ordered(state: NotesState): ReviewNote[] {
  const paths = [...new Set(state.notes.map((note) => note.path))];
  return paths.flatMap((path) => notesFor(state, path));
}

function block(note: ReviewNote, index: number): string {
  const sign = note.side === "new" ? "+" : "-";
  const code = note.code.length > CODE_CHARS ? note.code.slice(0, CODE_CHARS) : note.code;
  const text = note.text
    .split("\n")
    .map((row) => `   ${row}`)
    .join("\n");
  return `${index + 1}. ${note.path}:${note.line}\n   ${sign} ${code}\n${text}`;
}

export const NOTES_CLEARED = "Notes removed.";
export const NO_NOTES = "No notes.";

/** What `/notes` says: the count, then one row per note as `path:line  text`. */
export function notesNotice(state: NotesState): string {
  const chip = notesChip(state);
  if (chip === null) {
    return NO_NOTES;
  }
  const rows = ordered(state).map((note, index) => `${index + 1}. ${note.path}:${note.line}  ${note.text.split("\n").join(" ")}`);
  return [chip, ...rows].join("\n");
}

/** The message to send: the notes first, then the user's own text. */
export function withNotes(state: NotesState, text: string): string {
  if (state.notes.length === 0) {
    return text;
  }
  const notes = `Review notes:\n\n${ordered(state).map(block).join("\n\n")}`;
  return text === "" ? notes : `${notes}\n\n${text}`;
}

/** What a send takes: the text that goes out, and the ids of the notes in it, which `dropNotes` removes once it worked. */
export function takeNotes(state: NotesState, text: string): { text: string; ids: string[] } {
  return { text: withNotes(state, text), ids: state.notes.map((note) => note.id) };
}

/** The notes without these ids: a note written while the send ran stays. */
export function dropNotes(state: NotesState, ids: readonly string[]): NotesState {
  return { ...state, notes: state.notes.filter((note) => !ids.includes(note.id)) };
}
