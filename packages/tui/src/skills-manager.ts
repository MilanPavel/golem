import type { ListedSkill } from "@golem/client";

import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/skills`: every skill this folder sees, grouped by where it comes from,
 * then one skill's details. Broken, disabled, and shadowed skills are listed
 * too, with why. The skills are the app's list, kept current by
 * `skill.registry.changed`, so this state only says where the user is.
 */
export type SkillsManagerView =
  | { kind: "list"; selected: number }
  | { kind: "detail"; path: string; offset: number };

export type SkillsManagerState = { open: boolean; view: SkillsManagerView };

/** The skills `skill.list` returned for this folder, or why it could not. */
export type SkillList = { skills: readonly ListedSkill[] | null; error: string | null };

export const closedSkillsManager: SkillsManagerState = { open: false, view: { kind: "list", selected: 0 } };

export type SkillsManagerKey = "up" | "down" | "enter" | "back";

export type SkillsManagerAction = { kind: "none" } | { kind: "close" };

/** The same row shape as the MCP manager, so one component draws both. */
export type SkillsManagerLine = McpManagerLine;

export const SKILLS_HINT =
  "Add one as ~/.golem/skills/<name>/SKILL.md, or .agents/skills/<name>/SKILL.md in a project.";
const LIST_HINT = "↑/↓ to navigate · Enter to open · Esc to close";
const DETAIL_HINT = "↑/↓ to scroll · Esc to go back";
const GROUPS = { project: "This project", user: "Yours", bundled: "Bundled with golem" } as const;

export function openSkillsManager(): SkillsManagerState {
  return { open: true, view: { kind: "list", selected: 0 } };
}

export function skillsManagerKeyOf(press: Press): SkillsManagerKey | null {
  if (press.name === "up" || press.name === "down") {
    return press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "back";
  }
  return null;
}

export function pressSkillsManager(
  state: SkillsManagerState,
  skills: readonly ListedSkill[],
  key: SkillsManagerKey,
): { state: SkillsManagerState; action: SkillsManagerAction } {
  const none = { kind: "none" } as const;
  const view = state.view;
  if (view.kind === "list") {
    const selected = clamp(view.selected, skills.length);
    if (key === "back") {
      return { state: closedSkillsManager, action: { kind: "close" } };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), skills.length);
      return { state: { ...state, view: { kind: "list", selected: next } }, action: none };
    }
    const skill = skills[selected];
    if (key === "enter" && skill !== undefined) {
      return { state: { ...state, view: { kind: "detail", path: skill.path, offset: 0 } }, action: none };
    }
    return { state, action: none };
  }
  if (key === "back") {
    const index = Math.max(0, skills.findIndex((skill) => skill.path === view.path));
    return { state: { ...state, view: { kind: "list", selected: index } }, action: none };
  }
  if (key === "up" || key === "down") {
    const offset = Math.max(0, view.offset + (key === "up" ? -1 : 1));
    return { state: { ...state, view: { ...view, offset } }, action: none };
  }
  return { state, action: none };
}

export function layoutSkillsManager(input: {
  state: SkillsManagerState;
  skills: readonly ListedSkill[] | null;
  error: string | null;
  cwd: string;
  home: string;
  columns: number;
  rows: number;
}): SkillsManagerLine[] {
  const { state, home } = input;
  const width = Math.max(1, input.columns);
  const room = Math.max(0, input.rows - 2);
  let body: SkillsManagerLine[];
  let hint = LIST_HINT;
  if (input.error !== null) {
    body = [{ text: "Skills", bold: true }, { text: "" }, { text: input.error }];
  } else if (input.skills === null) {
    body = [{ text: "Skills", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else if (state.view.kind === "list") {
    body = scrollToSelected(listLines(input.skills, state.view.selected, input.cwd, home), room);
  } else {
    const view = state.view;
    const skill = input.skills.find((item) => item.path === view.path);
    if (skill === undefined) {
      body = scrollToSelected(listLines(input.skills, 0, input.cwd, home), room);
    } else {
      const lines = detailLines(skill, home, width);
      const start = Math.min(view.offset, Math.max(0, lines.length - room));
      body = lines.slice(start, start + room);
      hint = DETAIL_HINT;
    }
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

function listLines(skills: readonly ListedSkill[], selected: number, cwd: string, home: string): SkillsManagerLine[] {
  const usable = skills.filter((skill) => skill.usable).length;
  const count = `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`;
  const lines: SkillsManagerLine[] = [
    { text: "Skills", bold: true },
    { text: skills.length === usable ? count : `${count} · ${usable} usable`, dim: true },
  ];
  if (skills.length === 0) {
    return [...lines, { text: "" }, { text: SKILLS_HINT }];
  }
  const nameWidth = Math.max(...skills.map((skill) => skill.name.length));
  const chosen = clamp(selected, skills.length);
  let group: string | undefined;
  skills.forEach((skill, index) => {
    if (skill.source !== group) {
      group = skill.source;
      const where = skill.source === "project" ? ` (${shortPath(cwd, home)})` : "";
      lines.push({ text: "" }, { text: `  ${GROUPS[skill.source]}${where}`, bold: true });
    }
    lines.push({
      prefix: index === chosen ? "❯ " : "  ",
      mark: statusMark(skill),
      text: `${skill.name.padEnd(nameWidth)}  ${summary(skill, home)}`,
      selected: index === chosen,
      dim: !skill.usable,
    });
  });
  return lines;
}

function detailLines(skill: ListedSkill, home: string, width: number): SkillsManagerLine[] {
  const label = (key: string) => `${key}:`.padEnd(15);
  const indent = " ".repeat(15);
  const lines: SkillsManagerLine[] = [
    { text: `${skill.name} skill`, bold: true },
    { text: "" },
    { prefix: label("Status"), mark: statusMark(skill), text: statusWord(skill, home) },
    { text: `${label("From")}${GROUPS[skill.source]}` },
    { text: `${label("Folder")}${shortPath(skill.path, home)}` },
  ];
  const wrapped = (key: string, text: string) =>
    wrap(text, Math.max(10, width - 15)).forEach((part, index) => {
      lines.push({ text: `${index === 0 ? label(key) : indent}${part}` });
    });
  if (skill.description.length > 0) {
    wrapped("Description", skill.description);
  }
  lines.push({ text: `${label("You run it")}${skill.user_invocable === false ? "no" : runAs(skill)}` });
  lines.push({ text: `${label("Model uses it")}${skill.model_invocable === false ? "no, only you" : "when it fits"}` });
  if ((skill.allowed_tools ?? []).length > 0) {
    wrapped("Allowed tools", (skill.allowed_tools ?? []).join(", "));
  }
  if (skill.model) {
    lines.push({ text: `${label("Model")}${skill.model} (not used yet)` });
  }
  for (const [key, items, tone] of [
    ["Errors", skill.errors ?? [], "bad"],
    ["Warnings", skill.warnings ?? [], "wait"],
  ] as const) {
    if (items.length === 0) {
      continue;
    }
    lines.push({ text: "" }, { text: key, bold: true });
    for (const item of items) {
      wrap(item, Math.max(10, width - 2)).forEach((part, index) => {
        lines.push(index === 0 ? { mark: { text: tone === "bad" ? "✘" : "!", tone }, text: part } : { text: `  ${part}` });
      });
    }
  }
  return lines;
}

function summary(skill: ListedSkill, home: string): string {
  if ((skill.errors ?? []).length > 0) {
    return skill.errors?.[0] ?? "";
  }
  if (skill.disabled) {
    return "disabled in config.toml";
  }
  if (skill.shadowed_by) {
    return `hidden by ${shortPath(skill.shadowed_by, home)}`;
  }
  return firstLine(skill.description);
}

function statusMark(skill: ListedSkill): { text: string; tone: McpTone } {
  if ((skill.errors ?? []).length > 0) {
    return { text: "✘", tone: "bad" };
  }
  if (skill.usable) {
    return { text: (skill.warnings ?? []).length > 0 ? "!" : "✔", tone: (skill.warnings ?? []).length > 0 ? "wait" : "ok" };
  }
  return { text: "–", tone: "off" };
}

function statusWord(skill: ListedSkill, home: string): string {
  if ((skill.errors ?? []).length > 0) {
    return "broken: never used";
  }
  if (skill.disabled) {
    return "disabled in [skills] of config.toml";
  }
  if (skill.shadowed_by) {
    return `hidden by the skill in ${shortPath(skill.shadowed_by, home)}`;
  }
  return (skill.warnings ?? []).length > 0 ? "usable, with warnings" : "usable";
}

function runAs(skill: ListedSkill): string {
  return skill.argument_hint ? `/${skill.name} ${skill.argument_hint}` : `/${skill.name}`;
}

/** Keep the selected line on screen, with the title lines above it when they fit. */
function scrollToSelected(lines: SkillsManagerLine[], room: number): SkillsManagerLine[] {
  if (lines.length <= room) {
    return lines;
  }
  const selected = Math.max(0, lines.findIndex((line) => line.selected === true));
  const start = Math.min(Math.max(0, selected - room + 1), lines.length - room);
  return lines.slice(start, start + room);
}

/** Split on spaces into lines of at most `width`. A longer word is cut by `fit` later. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    if (current.length > 0 && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current.length > 0 ? `${current} ${word}` : word;
    }
  }
  return current.length > 0 ? [...lines, current] : lines;
}

function shortPath(path: string, home: string): string {
  return home.length > 0 && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
