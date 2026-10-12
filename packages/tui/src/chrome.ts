import { LOGO_ROWS, LOGO_WIDTH } from "./logo.ts";
import { wrapSpans } from "./layout-chat.ts";

export type FrameMode = "full" | "compact" | "hidden";

export type FrameBudget = {
  mode: FrameMode;
  header: number;
  body: number;
  banner: number;
  meter: number;
  composer: number;
  status: number;
};

export type ComposerRow = {
  prefix: string;
  text: string;
  cursor: boolean;
};

// A glyph in the last column wraps before the newline, so the frame grows and the header scrolls away.
export function frameColumns(terminalColumns: number): number {
  const width = Math.max(0, Math.floor(terminalColumns));
  return width > 1 ? width - 1 : width;
}

export function frameBudget(input: {
  rows: number;
  columns: number;
  draft: string;
  busy: boolean;
  banner: boolean;
}): FrameBudget {
  const rows = Math.max(0, Math.floor(input.rows));
  if (rows === 0) {
    return { mode: "hidden", header: 0, body: 0, banner: 0, meter: 0, composer: 0, status: 0 };
  }
  let header = input.rows >= 20 && input.columns >= LOGO_WIDTH + 24 ? LOGO_ROWS : 1;
  let composer = input.busy ? 1 : Math.min(5, composerLineCount(input.draft, input.columns));
  let meter = input.busy ? 1 : 0;
  let banner = input.banner ? 1 : 0;
  let status = 1;

  const shrink = (): boolean => {
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
    if (header > 0) {
      header = 0;
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

  while (header + banner + meter + composer + status >= rows && shrink()) {
    // Leave at least one row for the transcript when the terminal has a row.
  }

  const used = header + banner + meter + composer + status;
  return {
    mode: header >= LOGO_ROWS ? "full" : header > 0 ? "compact" : "hidden",
    header,
    body: rows - used,
    banner,
    meter,
    composer,
    status,
  };
}

export function composerLineCount(draft: string, columns: number): number {
  const { text } = draftWidth(Math.max(1, columns));
  return Math.max(1, wrapSpans([{ text: draft }], text).length);
}

export function layoutComposer(
  draft: string,
  columns: number,
  rows: number,
  busy: boolean,
): ComposerRow[] {
  if (rows <= 0) {
    return [];
  }
  if (busy) {
    return [{ prefix: "", text: "…", cursor: false }];
  }
  const measure = draftWidth(Math.max(1, columns));
  const wrapped = wrapSpans([{ text: draft }], measure.text);
  const visible = wrapped.slice(Math.max(0, wrapped.length - rows));
  const showingTail = wrapped.length > rows;
  return visible.map((spans, index) => {
    const text = spans.map((span) => span.text).join("");
    const prefix = measure.prefix === 0 ? "" : index === 0 && !showingTail ? "> " : "  ";
    const last = index === visible.length - 1;
    return { prefix, text, cursor: last && measure.cursor };
  });
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
