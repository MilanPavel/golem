/** What an edit of `config.toml`, or of one `[mcp.<name>]` in it, needs from the daemon and the person. */
export interface RawApi {
  get(): Promise<{ path: string; text: string; mtime_ns?: number | null }>;
  set(
    text: string,
    base: number | null,
  ): Promise<{
    ok: boolean;
    errors?: { line?: number | null; column?: number | null; path?: string | null; message: string }[];
    restart_needed?: string[];
  }>;
}

/** The part of the file that is edited: all of it, or one server's tables. */
export interface Region {
  /** The text to edit, and the 0-based line it starts at. Null when the file has none of it. */
  extract(full: string): { text: string; start: number } | null;
  /** `full` with `edited` where the region was. */
  splice(full: string, edited: string): string;
  /** What to call it when it is missing. */
  label: string;
}

export interface EditIo {
  /** Opens `text` in the editor. Null when the editor failed. */
  edit(text: string): Promise<string | null>;
  /** Asks a question and returns one of `keys`. */
  key(question: string, keys: string): Promise<string>;
  write(line: string): void;
  /** Restarts the daemon. */
  restart(): Promise<void>;
}

export const WHOLE_FILE: Region = {
  extract: (full) => ({ text: full, start: 0 }),
  splice: (_full, edited) => edited,
  label: "the file",
};

const HEADER = /^\s*\[(?!\[)(.+?)\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[\[?.+\]\]?\s*(?:#.*)?$/;

/** A table header's dotted key with spaces and quotes around its parts dropped: `[ mcp . "git" ]` is `mcp.git`. */
function headerKey(line: string): string | null {
  const found = HEADER.exec(line);
  if (found === null) return null;
  return (found[1] ?? "")
    .split(".")
    .map((part) => part.trim().replace(/^"(.*)"$/, "$1"))
    .join(".");
}

/** The tables of server `name`: `[mcp.<name>]` and the tables under it, from the first to the last that follow each other. */
export function mcpRegion(name: string): Region {
  const find = (lines: readonly string[]): { start: number; end: number } | null => {
    const belongs = (line: string): boolean => {
      const key = headerKey(line);
      return key !== null && (key === `mcp.${name}` || key.startsWith(`mcp.${name}.`));
    };
    const start = lines.findIndex(belongs);
    if (start === -1) return null;
    let end = start + 1;
    while (end < lines.length && (belongs(lines[end] ?? "") || !ANY_HEADER.test(lines[end] ?? ""))) end += 1;
    while (end > start + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
    return { start, end };
  };
  return {
    label: `[mcp.${name}]`,
    extract(full) {
      const lines = full.split("\n");
      const at = find(lines);
      return at === null ? null : { text: `${lines.slice(at.start, at.end).join("\n")}\n`, start: at.start };
    },
    splice(full, edited) {
      const lines = full.split("\n");
      const at = find(lines);
      if (at === null) return full;
      return [...lines.slice(0, at.start), ...edited.replace(/\n+$/, "").split("\n"), ...lines.slice(at.end)].join("\n");
    },
  };
}

type RawError = { line?: number | null; column?: number | null; path?: string | null; message: string };

/** One problem as a line: its place in what the person edited (or in the file, when it is outside), then the message. */
export function formatEditError(error: RawError, start: number, edited: string): string {
  const where = error.path ? ` (${error.path})` : "";
  if (error.line === undefined || error.line === null) return `${error.message}${where}`;
  const local = error.line - start;
  const count = edited.replace(/\n+$/, "").split("\n").length;
  const place = local >= 1 && local <= count ? `line ${local}` : `file line ${error.line}`;
  return `${place}: ${error.message}${where}`;
}

const SAME = (a: string, b: string): boolean => a.replace(/\n+$/, "") === b.replace(/\n+$/, "");

/**
 * Edit, check, and save, until it is saved or the person gives up. The daemon checks the text and writes it
 * only when it is valid and the file has not changed since it was read, so a failed save leaves the file as it was.
 * Returns the exit code.
 */
export async function editConfig(api: RawApi, region: Region, io: EditIo): Promise<number> {
  let file = await api.get();
  let original = region.extract(file.text);
  if (original === null) {
    io.write(`${file.path} has no ${region.label}`);
    return 1;
  }
  let working = original.text;
  for (;;) {
    const edited = await io.edit(working);
    if (edited === null) {
      io.write("the editor did not finish: nothing was changed");
      return 1;
    }
    if (SAME(edited, original.text)) {
      io.write("no changes");
      return 0;
    }
    const result = await api.set(region.splice(file.text, edited), file.mtime_ns ?? null);
    if (result.ok) {
      io.write(`saved ${file.path}`);
      const restart = result.restart_needed ?? [];
      if (restart.length > 0) {
        io.write(`these settings are read only when the daemon starts: ${restart.join(", ")}`);
        if ((await io.key("Restart the daemon now? [y/n] ", "yn")) === "y") await io.restart();
      }
      return 0;
    }
    const errors = result.errors ?? [];
    for (const error of errors) io.write(formatEditError(error, original.start, edited));
    if (errors.some((error) => /changed on disk/.test(error.message))) {
      if ((await io.key("[r]eload the file and edit again, or [d]iscard? ", "rd")) === "d") {
        io.write("discarded: the file is as it was");
        return 1;
      }
      file = await api.get();
      original = region.extract(file.text);
      if (original === null) {
        io.write(`${file.path} has no ${region.label} any more`);
        return 1;
      }
      working = original.text;
      continue;
    }
    if ((await io.key("[e]dit again or [d]iscard? ", "ed")) === "d") {
      io.write("discarded: the file is as it was");
      return 1;
    }
    working = edited;
  }
}
