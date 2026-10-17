import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Draft = {
  text: string;
  cursor: number;
};

export type EditOp =
  | "left"
  | "right"
  | "word-left"
  | "word-right"
  | "line-start"
  | "line-end"
  | "backspace"
  | "delete"
  | "delete-word"
  | "delete-to-start"
  | "delete-to-end"
  | "newline";

export function draftAt(text: string, cursor = text.length): Draft {
  return { text, cursor: snap(text, cursor) };
}

export function edit(draft: Draft, op: EditOp): Draft {
  const text = draft.text;
  const cursor = snap(text, draft.cursor);
  if (op === "left") {
    return { text, cursor: prev(text, cursor) };
  }
  if (op === "right") {
    return { text, cursor: next(text, cursor) };
  }
  if (op === "word-left") {
    return { text, cursor: wordLeft(text, cursor) };
  }
  if (op === "word-right") {
    return { text, cursor: wordRight(text, cursor) };
  }
  if (op === "line-start") {
    return { text, cursor: lineStart(text, cursor) };
  }
  if (op === "line-end") {
    return { text, cursor: lineEnd(text, cursor) };
  }
  if (op === "backspace") {
    const at = prev(text, cursor);
    return { text: text.slice(0, at) + text.slice(cursor), cursor: at };
  }
  if (op === "delete") {
    const at = next(text, cursor);
    return { text: text.slice(0, cursor) + text.slice(at), cursor };
  }
  if (op === "delete-word") {
    const at = wordLeft(text, cursor);
    return { text: text.slice(0, at) + text.slice(cursor), cursor: at };
  }
  if (op === "delete-to-start") {
    const at = lineStart(text, cursor);
    return { text: text.slice(0, at) + text.slice(cursor), cursor: at };
  }
  if (op === "delete-to-end") {
    const end = lineEnd(text, cursor);
    if (end > cursor) {
      return { text: text.slice(0, cursor) + text.slice(end), cursor };
    }
    if (cursor < text.length && text[cursor] === "\n") {
      return { text: text.slice(0, cursor) + text.slice(cursor + 1), cursor };
    }
    return { text, cursor };
  }
  return insertText({ text, cursor }, "\n");
}

/** Inserts at the cursor. Newlines stay in the draft, so a paste is still one message. */
export function insertText(draft: Draft, value: string): Draft {
  const chunk = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cursor = snap(draft.text, draft.cursor);
  return {
    text: draft.text.slice(0, cursor) + chunk + draft.text.slice(cursor),
    cursor: cursor + chunk.length,
  };
}

/** `$EDITOR`, split on spaces, or `vi` when it is unset. */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const editor = env.EDITOR?.trim() ?? "";
  const parts = editor.split(/\s+/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : ["vi"];
}

/**
 * Writes the draft to a temp file, runs the editor while the terminal is suspended,
 * and returns the saved text. A failed editor leaves the draft alone.
 * One trailing newline added by the editor is dropped when the draft had none.
 */
export async function editDraft(
  text: string,
  suspend: (run: () => Promise<void>) => Promise<void>,
  run: (command: readonly string[], file: string) => Promise<number> = runEditor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "golem-draft-"));
  const file = join(dir, "draft.txt");
  try {
    await writeFile(file, text, "utf8");
    let code = 1;
    await suspend(async () => {
      code = await run(editorCommand(env), file);
    });
    if (code !== 0) {
      return null;
    }
    const saved = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text.endsWith("\n") && saved.endsWith("\n") && !saved.endsWith("\n\n")) {
      return saved.slice(0, -1);
    }
    return saved;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runEditor(command: readonly string[], file: string): Promise<number> {
  const [bin, ...args] = command;
  if (bin === undefined) {
    return Promise.resolve(1);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args, file], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function snap(text: string, cursor: number): number {
  const index = Math.max(0, Math.min(cursor, text.length));
  const code = text.charCodeAt(index);
  if (index > 0 && code >= 0xdc00 && code <= 0xdfff) {
    return index - 1;
  }
  return index;
}

function prev(text: string, cursor: number): number {
  if (cursor <= 0) {
    return 0;
  }
  const code = text.charCodeAt(cursor - 1);
  if (code >= 0xdc00 && code <= 0xdfff && cursor >= 2) {
    return cursor - 2;
  }
  return cursor - 1;
}

function next(text: string, cursor: number): number {
  if (cursor >= text.length) {
    return text.length;
  }
  const code = text.charCodeAt(cursor);
  if (code >= 0xd800 && code <= 0xdbff && cursor + 1 < text.length) {
    return cursor + 2;
  }
  return cursor + 1;
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n";
}

function wordLeft(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && isSpace(text[index - 1])) {
    index -= 1;
  }
  while (index > 0 && !isSpace(text[index - 1])) {
    index -= 1;
  }
  return index;
}

function wordRight(text: string, cursor: number): number {
  let index = cursor;
  while (index < text.length && !isSpace(text[index])) {
    index += 1;
  }
  while (index < text.length && isSpace(text[index])) {
    index += 1;
  }
  return index;
}

function lineStart(text: string, cursor: number): number {
  const index = text.lastIndexOf("\n", cursor - 1);
  return index === -1 ? 0 : index + 1;
}

function lineEnd(text: string, cursor: number): number {
  const index = text.indexOf("\n", cursor);
  return index === -1 ? text.length : index;
}
