import type { ConfigGetResult } from "@golem/client";

import type { Press } from "./keys.ts";

type Action = "allow" | "ask" | "deny";

/** One row of `/permissions`: a rule in check order, or something this session allows. */
export type PermissionItem =
  | {
      kind: "rule";
      action: Action;
      tool: string;
      match: string | null;
      path: string | null;
      source: string;
      ignored: string | null;
      file: "user" | "project" | "default";
      index: number | null;
    }
  | { kind: "allowance"; tool: string; subject: string | null };

export type PermissionsState = {
  open: boolean;
  selected: number;
  config: ConfigGetResult | null;
};

export const closedPermissions: PermissionsState = { open: false, selected: 0, config: null };

export type PermissionsKey = "up" | "down" | "close" | "refresh" | "delete" | Action;

export type PermissionsAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "refresh" }
  | { kind: "notice"; text: string }
  | { kind: "update"; target: "user" | "project"; index: number; action: Action }
  | { kind: "remove"; target: "user" | "project"; index: number }
  | { kind: "revoke"; tool: string; subject: string | null };

export type PermissionsLine = { text: string; selected: boolean; dim: boolean };

export const PERMISSIONS_HINT = "↑↓ move · a allow · k ask · d deny · x delete · r refresh · Esc close";
export const DEFAULT_LOCKED = "built-in defaults cannot be changed; a rule in config.toml goes before them";

export function openPermissions(): PermissionsState {
  return { open: true, selected: 0, config: null };
}

/** Rules in check order, then what this session allows. */
export function permissionItems(config: ConfigGetResult | null): PermissionItem[] {
  if (config === null) {
    return [];
  }
  const rules: PermissionItem[] = config.rules.map((rule) => ({
    kind: "rule",
    action: rule.action,
    tool: rule.tool,
    match: rule.match ?? null,
    path: rule.path ?? null,
    source: rule.source,
    ignored: rule.ignored ?? null,
    file: rule.file ?? "default",
    index: rule.index ?? null,
  }));
  const allowed: PermissionItem[] = (config.session_allowed ?? []).map((item) => ({
    kind: "allowance",
    tool: item.tool,
    subject: item.subject ?? null,
  }));
  return [...rules, ...allowed];
}

export function permissionsKeyOf(press: Press): PermissionsKey | null {
  if (press.name === "up") {
    return "up";
  }
  if (press.name === "down") {
    return "down";
  }
  if (press.name === "escape") {
    return "close";
  }
  if (press.name === "delete" || press.name === "backspace") {
    return "delete";
  }
  if (press.ctrl || press.meta) {
    return null;
  }
  const keys: Record<string, PermissionsKey> = { a: "allow", k: "ask", d: "deny", x: "delete", r: "refresh" };
  return keys[press.input] ?? null;
}

export function pressPermissions(
  state: PermissionsState,
  key: PermissionsKey,
): { state: PermissionsState; action: PermissionsAction } {
  const items = permissionItems(state.config);
  const selected = Math.min(state.selected, Math.max(0, items.length - 1));
  if (key === "close") {
    return { state: closedPermissions, action: { kind: "close" } };
  }
  if (key === "refresh") {
    return { state, action: { kind: "refresh" } };
  }
  if (key === "up" || key === "down") {
    const step = key === "up" ? -1 : 1;
    const next = Math.min(Math.max(selected + step, 0), Math.max(0, items.length - 1));
    return { state: { ...state, selected: next }, action: { kind: "none" } };
  }
  const item = items[selected];
  if (item === undefined) {
    return { state, action: { kind: "none" } };
  }
  if (item.kind === "allowance") {
    if (key === "delete" || key === "deny") {
      return { state, action: { kind: "revoke", tool: item.tool, subject: item.subject } };
    }
    return { state, action: { kind: "notice", text: "x revokes what this session allows" } };
  }
  if (item.file === "default" || item.index === null) {
    return { state, action: { kind: "notice", text: DEFAULT_LOCKED } };
  }
  if (key === "delete") {
    return { state, action: { kind: "remove", target: item.file, index: item.index } };
  }
  if (key === item.action) {
    return { state, action: { kind: "none" } };
  }
  return { state, action: { kind: "update", target: item.file, index: item.index, action: key } };
}

/** The header, then at most `rows - 1` items scrolled to keep the selection on screen. */
export function layoutPermissions(state: PermissionsState, columns: number, rows: number): PermissionsLine[] {
  if (rows <= 0) {
    return [];
  }
  const width = Math.max(1, columns);
  const header: PermissionsLine = { text: fit(`Permissions  ${PERMISSIONS_HINT}`, width), selected: false, dim: true };
  if (state.config === null) {
    return [header, { text: "loading…", selected: false, dim: true }].slice(0, rows);
  }
  const items = permissionItems(state.config);
  const selected = Math.min(state.selected, Math.max(0, items.length - 1));
  const room = Math.max(0, rows - 1);
  const start = Math.min(Math.max(0, selected - room + 1), Math.max(0, items.length - room));
  const lines = items.slice(start, start + room).map((item, offset) => ({
    text: fit(itemText(item), width),
    selected: start + offset === selected,
    dim: item.kind === "rule" && (item.file === "default" || item.ignored !== null),
  }));
  return [header, ...lines];
}

export function itemText(item: PermissionItem): string {
  if (item.kind === "allowance") {
    const what = item.subject === null ? item.tool : `${item.tool} ${item.subject}`;
    return `  session  allow  ${what}  (for this session)`;
  }
  const scope = [item.tool];
  if (item.match !== null) {
    scope.push(`match "${item.match}"`);
  }
  if (item.path !== null) {
    scope.push(`path "${item.path}"`);
  }
  const note = item.ignored === null ? item.source : `${item.source}, ignored: ${item.ignored}`;
  return `  ${item.action.padEnd(5)}  ${scope.join(" ")}  ${note}`;
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
