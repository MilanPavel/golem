import { LOGO_ROWS, LOGO_WIDTH } from "./logo.ts";

export type FrameMode = "full" | "compact" | "hidden";

export type FrameBudget = {
  mode: FrameMode;
  header: number;
  body: number;
  banner: number;
  meter: number;
  suggestions: number;
  /** The approval band. It takes the place of the suggestions while a run waits. */
  approval: number;
  /** The agent's todo list, above the approval band and the suggestions. */
  todos: number;
  /** `brew install ollama`, above the todo list. */
  install: number;
  /** The thin rules around the composer: 2 is above and below, 1 is above only. */
  rules: number;
  composer: number;
  status: number;
  debug: number;
};

export type ComposerRow = {
  prefix: string;
  text: string;
  /** Index in `text` of the block cursor. `text.length` means the block sits after the line. */
  cursorAt: number | null;
  /** The row shows the placeholder of an empty draft, to draw dim. */
  placeholder?: boolean;
};

/** The composer's prompt, and the indent of the rows after the first. */
export const PROMPT = "❯ ";
const INDENT = "  ";
const COMPOSER_RULES = 2;

/** What an empty draft shows, one per session. */
export const PLACEHOLDERS = [
  'Try "explain this repo"',
  'Try "fix the failing test"',
  'Try "/model" to switch models',
  'Try "what changed since yesterday?"',
] as const;

/** The placeholder for `key`, such as a session id: the same key always gets the same one. */
export function placeholderFor(key: string): string {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return PLACEHOLDERS[hash % PLACEHOLDERS.length] ?? PLACEHOLDERS[0];
}

// A glyph in the last column wraps before the newline, so the frame grows and the header scrolls away.
export function frameColumns(terminalColumns: number): number {
  const width = Math.max(0, Math.floor(terminalColumns));
  return width > 1 ? width - 1 : width;
}

const DEBUG_ROWS = 7;
const SUGGEST_ROWS = 6;
const APPROVAL_MIN_ROWS = 3;
const COMPOSER_ROWS = 5;

export const HEADER_GAP = 2;
export const HEADER_PAD_TOP = 1;
export const HEADER_ROWS = HEADER_PAD_TOP + LOGO_ROWS + 1;

export function frameBudget(input: {
  rows: number;
  columns: number;
  draft: string;
  busy: boolean;
  banner: boolean;
  debug?: boolean;
  suggestions?: number;
  approval?: number;
  todos?: number;
  install?: number;
  /** The most rows the composer may grow to. */
  composerMax?: number;
}): FrameBudget {
  const rows = Math.max(0, Math.floor(input.rows));
  if (rows === 0) {
    return {
      mode: "hidden",
      header: 0,
      body: 0,
      banner: 0,
      meter: 0,
      suggestions: 0,
      approval: 0,
      todos: 0,
      install: 0,
      rules: 0,
      composer: 0,
      status: 0,
      debug: 0,
    };
  }
  let header = input.rows >= 20 && input.columns >= LOGO_WIDTH + HEADER_GAP + 24 ? HEADER_ROWS : 1;
  let composer = input.busy ? 1 : Math.min(input.composerMax ?? COMPOSER_ROWS, composerLineCount(input.draft, input.columns));
  let meter = input.busy ? 1 : 0;
  let banner = input.banner ? 1 : 0;
  let approval = Math.max(0, Math.floor(input.approval ?? 0));
  let todos = Math.max(0, Math.floor(input.todos ?? 0));
  let install = Math.max(0, Math.floor(input.install ?? 0));
  let suggestions = approval > 0 ? 0 : Math.min(SUGGEST_ROWS, Math.max(0, Math.floor(input.suggestions ?? 0)));
  let status = 1;
  let debug = input.debug === true ? DEBUG_ROWS : 0;
  let rules = COMPOSER_RULES;

  const shrink = (): boolean => {
    // The rules only frame the composer, so they go before anything with content.
    if (rules > 0) {
      rules -= 1;
      return true;
    }
    if (suggestions > 0) {
      suggestions -= 1;
      return true;
    }
    if (approval > APPROVAL_MIN_ROWS) {
      approval -= 1;
      return true;
    }
    if (todos > 1) {
      todos = 1;
      return true;
    }
    if (install > 1) {
      install -= 1;
      return true;
    }
    if (debug > 3) {
      debug -= 1;
      return true;
    }
    if (composer > 1) {
      composer -= 1;
      return true;
    }
    if (meter > 0) {
      meter = 0;
      return true;
    }
    if (header > 1) {
      header = 1;
      return true;
    }
    if (banner > 0) {
      banner = 0;
      return true;
    }
    if (debug > 0) {
      debug -= 1;
      return true;
    }
    if (header > 0) {
      header = 0;
      return true;
    }
    if (todos > 0) {
      todos = 0;
      return true;
    }
    if (install > 0) {
      install = 0;
      return true;
    }
    if (approval > 0) {
      approval -= 1;
      return true;
    }
    if (composer > 0) {
      composer = 0;
      return true;
    }
    if (status > 0) {
      status = 0;
      return true;
    }
    return false;
  };

  const total = (): number =>
    header + banner + meter + suggestions + approval + todos + install + rules + composer + status + debug;
  while (total() >= rows && shrink()) {
    // Leave at least one row for the transcript when the terminal has a row.
  }

  const used = total();
  return {
    mode: header >= HEADER_ROWS ? "full" : header > 0 ? "compact" : "hidden",
    header,
    body: rows - used,
    banner,
    meter,
    suggestions,
    approval,
    todos,
    install,
    rules,
    composer,
    status,
    debug,
  };
}

export function composerLineCount(draft: string, columns: number): number {
  const { text } = draftWidth(Math.max(1, columns));
  // composerLines keeps the empty row after a trailing newline. wrapSpans drops it.
  return Math.max(1, composerLines(draft, text).length);
}

export function layoutComposer(
  draft: string,
  cursor: number,
  columns: number,
  rows: number,
  busy: boolean,
  placeholder?: string,
): ComposerRow[] {
  if (rows <= 0) {
    return [];
  }
  if (busy) {
    return [{ prefix: "", text: "…", cursorAt: null }];
  }
  const measure = draftWidth(Math.max(1, columns));
  if (draft === "" && placeholder !== undefined && placeholder.length > 0) {
    // The cursor sits on the first letter, so the line reads as the place to type and needs no cell after it.
    const width = measure.text + (measure.cursor ? 1 : 0);
    const text = bannerText(placeholder, width);
    return [{ prefix: measure.prefix === 0 ? "" : PROMPT, text, cursorAt: 0, placeholder: true }];
  }
  const lines = composerLines(draft, measure.text);
  const at = Math.max(0, Math.min(cursor, draft.length));
  const cursorRow = lines.findIndex((line, index) => {
    const last = index === lines.length - 1;
    return last || at <= line.end;
  });
  const row = cursorRow === -1 ? 0 : cursorRow;
  const start = Math.max(0, Math.min(Math.max(0, row - rows + 1), Math.max(0, lines.length - rows)));
  const visible = lines.slice(start, start + rows);
  const showingTail = start > 0;
  return visible.map((line, index) => {
    const prefix = measure.prefix === 0 ? "" : index === 0 && !showingTail ? PROMPT : INDENT;
    const active = start + index === row;
    return { prefix, text: line.text, cursorAt: active ? cursorColumn(line, at) : null };
  });
}

/**
 * The cursor one composer row up (-1) or down (1), on the rows as drawn,
 * wrapped ones included. `goal` is the column to aim for, kept across short
 * rows so Up then Down comes back to it. Past the first row the cursor goes to
 * the start, and past the last row to the end.
 */
export function moveRow(
  draft: string,
  cursor: number,
  columns: number,
  direction: -1 | 1,
  goal: number | null = null,
): { cursor: number; goal: number | null } {
  const lines = composerLines(draft, draftWidth(Math.max(1, columns)).text);
  const at = Math.max(0, Math.min(cursor, draft.length));
  const found = lines.findIndex((line, index) => index === lines.length - 1 || at <= line.end);
  const row = found === -1 ? 0 : found;
  const current = lines[row];
  const target = lines[row + direction];
  if (current === undefined || target === undefined) {
    return { cursor: direction < 0 ? 0 : draft.length, goal: null };
  }
  const column = goal ?? cursorColumn(current, at);
  // A row cut inside a word ends before the next row starts, so stay on its last character.
  const end = row + direction === lines.length - 1 ? draft.length : target.end;
  return { cursor: Math.min(target.start + Math.min(column, target.text.length), end), goal: column };
}

type ComposerLine = {
  text: string;
  start: number;
  /** Last cursor index that still belongs on this line. */
  end: number;
};

function composerLines(source: string, width: number): ComposerLine[] {
  const widthSafe = Math.max(1, width);
  const lines: ComposerLine[] = [];
  let text = "";
  let used = 0;
  let start = 0;
  let index = 0;

  const push = (end: number) => {
    lines.push({ text, start, end });
    text = "";
    used = 0;
    start = end;
  };

  while (index < source.length) {
    if (source[index] === "\n") {
      push(index);
      index += 1;
      start = index;
      continue;
    }
    const room = widthSafe - used;
    let next = index;
    while (next < source.length && source[next] !== "\n" && next - index < room) {
      next += 1;
    }
    const window = source.slice(index, next);
    if (next < source.length && source[next] !== "\n" && window.length === room) {
      let take = window.lastIndexOf(" ");
      if (take <= 0) {
        take = room;
      }
      text += source.slice(index, index + take);
      index += take;
      const boundary = source[index] === " " ? index : index - 1;
      if (source[index] === " ") {
        index += 1;
      }
      push(boundary);
      start = index;
      continue;
    }
    text += window;
    used += window.length;
    index = next;
  }
  push(source.length);
  return lines;
}

function cursorColumn(line: ComposerLine, cursor: number): number {
  if (cursor >= line.start + line.text.length) {
    return line.text.length;
  }
  return Math.max(0, cursor - line.start);
}

export function bannerText(message: string, columns: number): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (columns <= 0) {
    return "";
  }
  if (flat.length <= columns) {
    return flat;
  }
  if (columns === 1) {
    return "…";
  }
  return `${flat.slice(0, columns - 1)}…`;
}

function draftWidth(columns: number): { prefix: number; text: number; cursor: boolean } {
  const prefix = columns >= 3 ? 2 : 0;
  const cursor = columns - prefix >= 1;
  const text = Math.max(1, columns - prefix - (cursor ? 1 : 0));
  return { prefix, text, cursor };
}
