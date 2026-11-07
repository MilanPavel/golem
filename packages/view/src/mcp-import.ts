import type { McpImportApplyParams, McpImportCandidate, McpImportScanResult } from "@golem/client";
import { mcpNameError } from "./mcp-catalog.ts";

/**
 * Importing the servers other apps have: what a list of them says, which are picked to start
 * with, and the `mcp.import.apply` params for the picks. Pure, so every UI shares it. A secret
 * value is typed once, here, and goes only into `secrets`; a scan never holds one.
 */

export type ImportSource = McpImportScanResult["sources"][number];

/** A candidate with the source it was found in. `key` is the daemon's, and picks go by it. */
export type ImportItem = { key: string; source: ImportSource; candidate: McpImportCandidate };

/** Every candidate of `sources`, in the order they are listed. */
export function importItems(sources: readonly ImportSource[]): ImportItem[] {
  return sources.flatMap((source) => (source.candidates ?? []).map((candidate) => ({ key: candidate.key, source, candidate })));
}

/** What a candidate runs or reaches. */
export function candidateTarget(candidate: McpImportCandidate): string {
  const { config } = candidate;
  if (config.url != null) {
    return config.url;
  }
  return [config.command ?? "", ...(config.args ?? [])].join(" ").trim();
}

/** The short notes beside a candidate. */
export function candidateNotes(candidate: McpImportCandidate): string[] {
  const notes: string[] = [];
  if (candidate.already_same === true) {
    notes.push("already added");
  } else if (candidate.clash === true) {
    notes.push(`will be named ${candidate.name}`);
  }
  if (candidate.scope === "project") {
    notes.push("this project");
  }
  return notes;
}

/** The candidates picked to start with: every one golem does not already have. */
export function initialPicks(items: readonly ImportItem[]): Set<string> {
  return new Set(items.filter((item) => item.candidate.already_same !== true).map((item) => item.key));
}

/** The references the picked candidates need a value for, each once, in the order they appear. */
export function missingRefsOf(items: readonly ImportItem[], picked: ReadonlySet<string>): string[] {
  const refs = new Set<string>();
  for (const item of items) {
    if (picked.has(item.key)) {
      for (const ref of item.candidate.missing_refs ?? []) {
        refs.add(ref);
      }
    }
  }
  return [...refs];
}

/**
 * The `mcp.import.apply` params for the picks, or what is wrong. `names` holds a name typed over a
 * candidate's own, and `values` the secrets typed by reference; an empty value is left out, to be
 * set later.
 */
export function applyParams(
  scanId: string,
  items: readonly ImportItem[],
  picked: ReadonlySet<string>,
  names: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): McpImportApplyParams | { error: string } {
  const chosen = items.filter((item) => picked.has(item.key));
  if (chosen.length === 0) {
    return { error: "Pick at least one server." };
  }
  const taken = new Set<string>();
  const picks = [];
  for (const item of chosen) {
    const name = (names[item.key] ?? item.candidate.name).trim();
    const problem = mcpNameError(name);
    if (problem !== null) {
      return { error: `${item.candidate.original_name}: ${problem}` };
    }
    if (taken.has(name)) {
      return { error: `Two servers would be named ${name}. Rename one.` };
    }
    taken.add(name);
    picks.push({ key: item.key, name, scope: item.candidate.scope });
  }
  const secrets: Record<string, string> = {};
  for (const ref of missingRefsOf(items, picked)) {
    const value = values[ref] ?? "";
    if (value.length > 0) {
      secrets[ref] = value;
    }
  }
  const [head, ...rest] = picks;
  if (head === undefined) {
    return { error: "Pick at least one server." };
  }
  return { scan_id: scanId, picks: [head, ...rest], secrets };
}

/** How many servers were found, for a heading: `3 servers in 2 files`. */
export function scanSummary(sources: readonly ImportSource[]): string {
  const servers = importItems(sources).length;
  const files = sources.filter((source) => (source.candidates ?? []).length > 0).length;
  return `${servers} ${servers === 1 ? "server" : "servers"} in ${files} ${files === 1 ? "place" : "places"}`;
}
