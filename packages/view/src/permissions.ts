import type { ConfigGetResult } from "@golem/client";

export type Action = "allow" | "ask" | "deny";

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

/** What a change to a row comes to. */
export type PermissionsAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "refresh" }
  | { kind: "notice"; text: string }
  | { kind: "update"; target: "user" | "project"; index: number; action: Action }
  | { kind: "remove"; target: "user" | "project"; index: number }
  | { kind: "revoke"; tool: string; subject: string | null };

/** What can be done to a row: set a rule's action, delete it, or revoke an allowance. */
export type RuleKey = Action | "delete";

export const DEFAULT_LOCKED = "built-in defaults cannot be changed; a rule in config.toml goes before them";

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

/** What `key` does to `item`: the same result in the terminal and on the page. */
export function ruleChange(item: PermissionItem, key: RuleKey): PermissionsAction {
  if (item.kind === "allowance") {
    if (key === "delete" || key === "deny") {
      return { kind: "revoke", tool: item.tool, subject: item.subject };
    }
    return { kind: "notice", text: "x revokes what this session allows" };
  }
  if (item.file === "default" || item.index === null) {
    return { kind: "notice", text: DEFAULT_LOCKED };
  }
  if (key === "delete") {
    return { kind: "remove", target: item.file, index: item.index };
  }
  if (key === item.action) {
    return { kind: "none" };
  }
  return { kind: "update", target: item.file, index: item.index, action: key };
}

/** True when the change lets something run without asking: a rule set to allow, or a deny or ask rule removed. */
export function isLoosening(item: PermissionItem, key: RuleKey): boolean {
  if (item.kind !== "rule") {
    return false;
  }
  if (key === "delete") {
    return item.action !== "allow";
  }
  return key === "allow" && item.action !== "allow";
}
