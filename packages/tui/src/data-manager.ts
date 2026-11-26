import { RpcError, type DataDescribeResult, type DataSource } from "@golem/client";
import {
  columnStats,
  COLUMNS_CAPTION,
  countText,
  groupSources,
  kindWord,
  PRIVACY_CHIP,
  sampleCaption,
  SAMPLE_SCHEMA_NOTE,
  savedInText,
  sourceDetail,
} from "@golem/view";

import { tableLines } from "./data-table.ts";
import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/data`: the data sources in the groups the web shows (this project, yours), then one source to read:
 * its tables with their columns and types, its notes, and the sample rows the daemon returns. Enter
 * opens a source, Esc goes back. The list and the description are the app's, so this state only says
 * where the pointer is. The words come from `@golem/view`.
 */
export type DataManagerView = { kind: "list"; selected: number } | { kind: "detail"; name: string; scroll: number };
export type DataManagerState = { open: boolean; view: DataManagerView };

/** The sources `data.list` returned, or why it could not. */
export type DataList = { sources: readonly DataSource[] | null; error: string | null };

/** The description `data.describe` returned for one source, or why it could not. */
export type DataDetail = { name: string; result: DataDescribeResult | null; error: string | null };

export const closedDataManager: DataManagerState = { open: false, view: { kind: "list", selected: 0 } };

export type DataManagerKey = "up" | "down" | "page-up" | "page-down" | "enter" | "back";

export type DataManagerAction = { kind: "none" } | { kind: "close" } | { kind: "open"; name: string } | { kind: "back" };

/** The same row shape as the MCP manager, so one component draws both. */
export type DataManagerLine = McpManagerLine;

/** What a daemon that lacks the data methods says. */
export const NO_DATA_METHODS = "This golem daemon does not know data sources yet.";

const METHOD_NOT_FOUND = -32601;
const LIST_HINT = "↑/↓ to navigate · Enter to open · Esc to close";
const DETAIL_HINT = "↑/↓ to scroll · Esc to go back";
const NO_SOURCES = "No data sources yet. golem data add <path> adds one.";

/** The one plain line for a failed `data.list` or `data.describe`. */
export function dataFailed(error: unknown): string {
  if (error instanceof RpcError && error.code === METHOD_NOT_FOUND) return NO_DATA_METHODS;
  return error instanceof Error && error.message.length > 0 ? error.message : "request failed";
}

export function openDataManager(name: string | null = null): DataManagerState {
  return { open: true, view: name === null ? { kind: "list", selected: 0 } : { kind: "detail", name, scroll: 0 } };
}

export function dataManagerKeyOf(press: Press): DataManagerKey | null {
  if (press.name === "up" || press.name === "down" || press.name === "page-up" || press.name === "page-down") return press.name;
  if (press.name === "return") return "enter";
  return press.name === "escape" ? "back" : null;
}

/** Every source in the order of the screen: the project's, then yours. */
export function orderedSources(sources: readonly DataSource[], folder: string | null): DataSource[] {
  const groups = groupSources(sources, folder);
  return [...(groups.project ?? []), ...groups.yours];
}

export type DataScreen = { list: DataList; detail: DataDetail | null; folder: string | null; columns: number; rows: number };

export function pressDataManager(state: DataManagerState, screen: DataScreen, key: DataManagerKey): { state: DataManagerState; action: DataManagerAction } {
  const view = state.view;
  if (view.kind === "list") {
    const items = orderedSources(screen.list.sources ?? [], screen.folder);
    const selected = clamp(view.selected, items.length);
    if (key === "back") return { state: closedDataManager, action: { kind: "close" } };
    if (key === "up" || key === "down") {
      return { state: { ...state, view: { kind: "list", selected: clamp(selected + (key === "up" ? -1 : 1), items.length) } }, action: { kind: "none" } };
    }
    const source = items[selected];
    if (key !== "enter" || source === undefined) return { state, action: { kind: "none" } };
    return { state: { ...state, view: { kind: "detail", name: source.name, scroll: 0 } }, action: { kind: "open", name: source.name } };
  }
  if (key === "back") return { state: { ...state, view: { kind: "list", selected: indexOfSource(screen, view.name) } }, action: { kind: "back" } };
  const room = Math.max(1, screen.rows - 2);
  const total = detailLines(screen.detail, view.name, screen.columns).length;
  const max = Math.max(0, total - room);
  const step = key === "page-up" || key === "page-down" ? Math.max(1, room - 1) : 1;
  const toward = key === "up" || key === "page-up" ? -1 : key === "down" || key === "page-down" ? 1 : 0;
  const scroll = Math.min(max, Math.max(0, view.scroll + toward * step));
  return { state: { ...state, view: { ...view, scroll } }, action: { kind: "none" } };
}

function indexOfSource(screen: DataScreen, name: string): number {
  return Math.max(0, orderedSources(screen.list.sources ?? [], screen.folder).findIndex((source) => source.name === name));
}

/** ● ready, … reading, ! needs a decision, ✘ failed. */
export function statusMark(source: DataSource): { text: string; tone: McpTone } {
  if (source.status === "ready") return { text: "●", tone: "ok" };
  if (source.status === "reading") return { text: "…", tone: "wait" };
  if (source.status === "untrusted") return { text: "!", tone: "wait" };
  return { text: "✘", tone: "bad" };
}

export function layoutDataManager(input: { state: DataManagerState; screen: DataScreen }): DataManagerLine[] {
  const { screen } = input;
  const width = Math.max(1, screen.columns);
  const room = Math.max(0, screen.rows - 2);
  const view = input.state.view;
  let body: DataManagerLine[];
  let hint: string;
  if (view.kind === "list") {
    hint = LIST_HINT;
    if (screen.list.error !== null) body = [{ text: "Data", bold: true }, { text: "" }, { text: screen.list.error }];
    else if (screen.list.sources === null) body = [{ text: "Data", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
    else body = scrollToSelected(listLines(screen.list.sources, view.selected, screen.folder), room);
  } else {
    hint = DETAIL_HINT;
    const all = detailLines(screen.detail, view.name, screen.columns);
    const max = Math.max(0, all.length - room);
    const start = Math.min(view.scroll, max);
    body = all.slice(start, start + room);
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, screen.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

function folderName(folder: string): string {
  return folder.split("/").filter((part) => part.length > 0).pop() ?? folder;
}

function listLines(sources: readonly DataSource[], selected: number, folder: string | null): DataManagerLine[] {
  const groups = groupSources(sources, folder);
  const items = [...(groups.project ?? []), ...groups.yours];
  if (items.length === 0) return [{ text: "Data", bold: true }, { text: "no data sources", dim: true }, { text: "" }, { text: NO_SOURCES }];
  const nameWidth = Math.max(...items.map((source) => source.name.length));
  const kindWidth = Math.max(...items.map((source) => kindWord(source.kind).length));
  const detailWidth = Math.max(...items.map((source) => sourceDetail(source).length));
  const chosen = clamp(selected, items.length);
  const lines: DataManagerLine[] = [{ text: "Data", bold: true }, { text: `${items.length} ${items.length === 1 ? "source" : "sources"}`, dim: true }];
  let index = 0;
  const group = (heading: string, members: readonly DataSource[]): void => {
    if (members.length === 0) return;
    lines.push({ text: "" }, { text: `  ${heading}`, bold: true });
    for (const source of members) {
      const ready = source.status === "ready";
      const detail = sourceDetail(source);
      lines.push({
        prefix: index === chosen ? "❯ " : "  ",
        mark: statusMark(source),
        text: `${source.name.padEnd(nameWidth)}  ${kindWord(source.kind).padEnd(kindWidth)}  ${ready ? detail.padEnd(detailWidth) : detail}${ready ? `  ${PRIVACY_CHIP[source.privacy]}` : ""}`.trimEnd(),
        selected: index === chosen,
      });
      index += 1;
    }
  };
  if (groups.project !== null) group(`this project · ${folder === null ? "" : folderName(folder)}`, groups.project);
  group("yours · every chat", groups.yours);
  return lines;
}

/** The source, then each table: columns with types and stats, and the sample rows. */
export function detailLines(detail: DataDetail | null, name: string, columns: number): DataManagerLine[] {
  if (detail === null || detail.name !== name) return [{ text: name, bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  if (detail.error !== null) return [{ text: name, bold: true }, { text: "" }, { text: detail.error }];
  const result = detail.result;
  if (result === null) return [{ text: name, bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  const { source } = result;
  const chip = [kindWord(source.kind), PRIVACY_CHIP[source.privacy]];
  const size = sourceDetail(source);
  const lines: DataManagerLine[] = [{ text: `${source.name}  ${chip.join(" · ")}`, bold: true }];
  lines.push({ text: `  ${source.location}`, dim: true }, { text: `  saved in ${savedInText(source.scope)}`, dim: true });
  if (source.status !== "ready") lines.push({ text: `  ${size}`, mark: statusMark(source) });
  if (source.privacy_reason) lines.push({ text: `  ${source.privacy_reason}`, dim: true });
  for (const each of result.tables) {
    lines.push({ text: "" }, { text: `${each.name}${each.rows === null || each.rows === undefined ? "" : `  ${countText(each.rows)} rows`}`, bold: true });
    const cols = each.columns ?? [];
    if (cols.length > 0) {
      lines.push({ text: `  ${COLUMNS_CAPTION}`, dim: true });
      const nameWidth = Math.max(...cols.map((column) => column.name.length));
      const typeWidth = Math.max(...cols.map((column) => column.type.length));
      for (const column of cols) lines.push({ text: `    ${column.name.padEnd(nameWidth)}  ${column.type.padEnd(typeWidth)}  ${columnStats(column)}`.trimEnd() });
    }
    const sample = result.sample[each.name];
    if (sample !== undefined && sample.length > 0) {
      lines.push({ text: `  sample · ${sampleCaption(source.privacy)}`, dim: true });
      for (const row of tableLines(cols, sample, Math.max(1, columns - 3)).lines) {
        lines.push({ text: `  ${row.map((span) => span.text).join("")}` });
      }
    } else if (source.privacy === "schema") {
      lines.push({ text: `  ${SAMPLE_SCHEMA_NOTE}`, dim: true });
    }
  }
  const notes = result.notes?.trim();
  if (notes) lines.push({ text: "" }, { text: "notes", bold: true }, ...notes.split("\n").map((line) => ({ text: `  ${line}` })));
  const queries = result.queries ?? [];
  if (queries.length > 0) {
    lines.push({ text: "" }, { text: "saved queries", bold: true });
    for (const query of queries) lines.push({ text: `  ${query.name}${query.description ? `  ${query.description}` : ""}` });
  }
  return lines;
}

/** Keep the selected line on screen, with the title lines above it when they fit. */
function scrollToSelected(lines: DataManagerLine[], room: number): DataManagerLine[] {
  if (lines.length <= room) return lines;
  const selected = Math.max(0, lines.findIndex((line) => line.selected === true));
  const start = Math.min(Math.max(0, selected - room + 1), lines.length - room);
  return lines.slice(start, start + room);
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
