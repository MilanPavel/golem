import type { McpImportCandidate } from "../../protocol/gen/mcp-import-candidate.ts";
import type { McpImportScanResult } from "../../protocol/gen/mcp-import-scan-result.ts";

type Source = McpImportScanResult["sources"][number];

/** A candidate with the number the person picks it by. */
export interface Numbered {
  n: number;
  source: Source;
  candidate: McpImportCandidate;
}

/** The app ids `--from` knows. Anything else is a file. */
export const IMPORT_SOURCES = ["claude-desktop", "claude-code", "cursor", "vscode", "windsurf"] as const;

export function isImportSource(word: string): boolean {
  return (IMPORT_SOURCES as readonly string[]).includes(word);
}

/** Every candidate of `sources`, numbered from 1 in the order they are listed. */
export function numbered(sources: readonly Source[]): Numbered[] {
  const items: Numbered[] = [];
  for (const source of sources) {
    for (const candidate of source.candidates ?? []) items.push({ n: items.length + 1, source, candidate });
  }
  return items;
}

/** What a candidate runs or reaches. */
export function targetOf(candidate: McpImportCandidate): string {
  const { config } = candidate;
  if (config.url !== undefined && config.url !== null) return config.url;
  return [config.command ?? "", ...(config.args ?? [])].join(" ");
}

/** The sources and their candidates, numbered, with each one's warnings, and what could not be read. */
export function formatScan(sources: readonly Source[]): string {
  const lines: string[] = [];
  let n = 0;
  for (const source of sources) {
    lines.push(`${source.label}${source.path ? ` (${source.path})` : ""}`);
    if (source.error) lines.push(`  ${source.error}`);
    for (const candidate of source.candidates ?? []) {
      n += 1;
      const notes: string[] = [];
      if (candidate.already_same) notes.push("already added");
      else if (candidate.clash) notes.push(`will be named ${candidate.name}`);
      if (candidate.scope === "project") notes.push("this project");
      lines.push(`  ${String(n).padStart(2)}  ${candidate.original_name}  ${targetOf(candidate)}${notes.length > 0 ? `  (${notes.join(", ")})` : ""}`);
      for (const warning of candidate.warnings ?? []) lines.push(`        ! ${warning}`);
    }
    for (const skipped of source.skipped ?? []) lines.push(`  skipped ${skipped}`);
  }
  return lines.join("\n");
}

export type Picks = { ok: true; picks: { key: string; name: string; scope: "user" | "project" }[] } | { ok: false; message: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

/** The candidates that are not already added: what `--all` and `a` mean. */
export function allNew(items: readonly Numbered[]): Numbered[] {
  return items.filter((item) => !item.candidate.already_same);
}

/** `1 3`, `2=my-name`, or `a` for every new one. Empty is none. */
export function parsePicks(answer: string, items: readonly Numbered[]): Picks {
  const chosen: Numbered[] = [];
  const names = new Map<number, string>();
  for (const word of answer.split(/[\s,]+/).filter((each) => each.length > 0)) {
    if (word.toLowerCase() === "a") {
      chosen.push(...allNew(items));
      continue;
    }
    const at = word.indexOf("=");
    const n = Number(at === -1 ? word : word.slice(0, at));
    const item = Number.isInteger(n) ? items.find((each) => each.n === n) : undefined;
    if (item === undefined) return { ok: false, message: `${word} is not a number in the list` };
    if (at !== -1) {
      const name = word.slice(at + 1);
      if (!NAME.test(name)) return { ok: false, message: `${name} is not a server name: letters, digits, and -, up to 32` };
      names.set(n, name);
    }
    chosen.push(item);
  }
  const seen = new Set<number>();
  const picks = chosen
    .filter((item) => !seen.has(item.n) && seen.add(item.n))
    .map((item) => ({ key: item.candidate.key, name: names.get(item.n) ?? item.candidate.name, scope: item.candidate.scope }));
  const taken = new Set<string>();
  for (const pick of picks) {
    if (taken.has(pick.name)) return { ok: false, message: `two servers would be named ${pick.name}: rename one with <number>=<name>` };
    taken.add(pick.name);
  }
  return { ok: true, picks };
}

/** The references the picked candidates need a value for, each once. */
export function missingRefs(items: readonly Numbered[], keys: readonly string[]): string[] {
  const refs = new Set<string>();
  for (const item of items) {
    if (keys.includes(item.candidate.key)) for (const ref of item.candidate.missing_refs ?? []) refs.add(ref);
  }
  return [...refs];
}
