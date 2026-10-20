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
  composer: number;
  status: number;
  debug: number;
};

export type ComposerRow = {
  prefix: string;
  text: string;
  /** Index in `text` of the block cursor. `text.length` means the block sits after the line. */
  cursorAt: number | null;
};

// A glyph in the last column wraps before the newline, so the frame grows and the header scrolls away.
export function frameColumns(terminalColumns: number): number {
  const width = Math.max(0, Math.floor(terminalColumns));
  return width > 1 ? width - 1 : width;
}

const DEBUG_ROWS = 7;
const SUGGEST_ROWS = 6;
const APPROVAL_MIN_ROWS = 3;

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
      composer: 0,
      status: 0,
      debug: 0,
    };
  }
  let header = input.rows >= 20 && input.columns >= LOGO_WIDTH + HEADER_GAP + 24 ? HEADER_ROWS : 1;
  let composer = input.busy ? 1 : Math.min(5, composerLineCount(input.draft, input.columns));
  let meter = input.busy ? 1 : 0;
  let banner = input.banner ? 1 : 0;
  let approval = Math.max(0, Math.floor(input.approval ?? 0));
  let suggestions = approval > 0 ? 0 : Math.min(SUGGEST_ROWS, Math.max(0, Math.floor(input.suggestions ?? 0)));
  let status = 1;
  let debug = input.debug === true ? DEBUG_ROWS : 0;

  const shrink = (): boolean => {
    if (suggestions > 0) {
      suggestions -= 1;
      return true;
    }
    if (approval > APPROVAL_MIN_ROWS) {
      approval -= 1;
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

  while (header + banner + meter + suggestions + approval + composer + status + debug >= rows && shrink()) {
    // Leave at least one row for the transcript when the terminal has a row.
  }

  const used = header + banner + meter + suggestions + approval + composer + status + debug;
  return {
    mode: header >= HEADER_ROWS ? "full" : header > 0 ? "compact" : "hidden",
    header,
    body: rows - used,
    banner,
    meter,
    suggestions,
    approval,
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
): ComposerRow[] {
  if (rows <= 0) {
    return [];
  }
  if (busy) {
    return [{ prefix: "", text: "…", cursorAt: null }];
  }
  const measure = draftWidth(Math.max(1, columns));
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
    const prefix = measure.prefix === 0 ? "" : index === 0 && !showingTail ? "> " : "  ";
    const active = start + index === row;
    return { prefix, text: line.text, cursorAt: active ? cursorColumn(line, at) : null };
  });
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
