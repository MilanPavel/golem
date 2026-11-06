import type { ConfigGetResult } from "@golem/client";
import {
  itemText,
  permissionItems,
  ruleChange,
  type Action,
  type PermissionsAction,
} from "@golem/view";

import type { Press } from "./keys.ts";

export type PermissionsState = {
  open: boolean;
  selected: number;
  config: ConfigGetResult | null;
};

export const closedPermissions: PermissionsState = { open: false, selected: 0, config: null };

export type PermissionsKey = "up" | "down" | "close" | "refresh" | "delete" | Action;

export type PermissionsLine = { text: string; selected: boolean; dim: boolean };

export const PERMISSIONS_HINT = "↑↓ move · a allow · k ask · d deny · x delete · r refresh · Esc close";
export { DEFAULT_LOCKED, itemText, permissionItems, type PermissionItem } from "@golem/view";

export function openPermissions(): PermissionsState {
  return { open: true, selected: 0, config: null };
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
  return { state, action: ruleChange(item, key) };
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

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
