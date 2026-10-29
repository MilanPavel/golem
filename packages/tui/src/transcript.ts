import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expandHome, golemDir } from "./history.ts";

export type CopyMessage = {
  role: string;
  text: string;
};

export type TailAnchor = {
  lines: number;
  /** Content width. A change here is a reflow, not new text. */
  columns: number;
  /** Rows that arrived after the view left the newest line. */
  fresh: number;
};

/** The newest assistant text, or null when there is nothing to copy. */
export function copyAnswer(messages: readonly CopyMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "assistant" && message.text.length > 0) {
      return message.text;
    }
  }
  return null;
}

/** The last fenced block in the transcript. The fence marker and language tag are left out. */
export function copyCode(messages: readonly CopyMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    const block = lastFencedCode(message.text);
    if (block !== null) {
      return block;
    }
  }
  return null;
}

export function lastFencedCode(text: string): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const body = match[1];
    if (body !== undefined) {
      found = body.replace(/\n$/, "");
    }
  }
  return found;
}

/** One markdown document from the messages on screen. */
export function sessionMarkdown(title: string, messages: readonly CopyMessage[]): string {
  const heading = title.trim().length > 0 ? title.trim().replace(/\s+/g, " ") : "untitled";
  const parts = [`# ${heading}`, ""];
  for (const message of messages) {
    if (message.text.length === 0) {
      continue;
    }
    const who = message.role === "user" ? "you" : "golem";
    parts.push(`**${who}**`, "", message.text, "");
  }
  return `${parts.join("\n")}`;
}

export function exportFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .slice(0, 80)
    .trim();
  return `${cleaned.length > 0 ? cleaned : "untitled"}.md`;
}

/** A given path wins. Otherwise `~/.golem/exports/<title>.md`, under `GOLEM_HOME` when that is set. */
export function exportDestination(input: {
  env?: NodeJS.ProcessEnv;
  home: string;
  title: string;
  given: string | null;
}): string {
  const given = input.given?.trim() ?? "";
  if (given.length > 0) {
    return expandHome(given, input.home);
  }
  return join(golemDir(input.env, input.home), "exports", exportFileName(input.title));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}m ${whole % 60}s`;
}

/** `14:02` today, `2026-10-16 14:02` on an earlier day. Local time. */
export function formatMessageTime(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at) || !Number.isFinite(nowMs)) {
    return "";
  }
  const when = new Date(at);
  const now = new Date(nowMs);
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  if (
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate()
  ) {
    return clock;
  }
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${clock}`;
}

export function newLinesLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }
  const lines = Math.floor(count);
  return lines === 1 ? "\u2193 1 new line" : `\u2193 ${lines} new lines`;
}

/**
 * While the view is away from the newest line, rows that arrive stay below it.
 * A width change resets the baseline so a reflow is not counted as new text.
 * Offset 0 clears the count.
 */
export function followTail(
  anchor: TailAnchor | null,
  lineCount: number,
  columns: number,
  offset: number,
): { anchor: TailAnchor; offset: number; fresh: number } {
  const count = Math.max(0, Math.floor(lineCount));
  const width = Math.max(1, Math.floor(columns));
  const place = Math.max(0, Math.floor(offset));
  if (anchor === null || anchor.columns !== width) {
    const fresh = anchor !== null && place > 0 ? anchor.fresh : 0;
    return { anchor: { lines: count, columns: width, fresh }, offset: place, fresh };
  }
  if (place <= 0) {
    return { anchor: { lines: count, columns: width, fresh: 0 }, offset: 0, fresh: 0 };
  }
  const added = Math.max(0, count - anchor.lines);
  const fresh = anchor.fresh + added;
  return { anchor: { lines: count, columns: width, fresh }, offset: place + added, fresh };
}

export async function writeExport(file: string, markdown: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, markdown, "utf8");
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
