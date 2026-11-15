import type { ListedSkill } from "@golem/client";

import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/skills`: every skill this folder sees, grouped by where it comes from,
 * then one skill's details and what you can do with it, and the form for a new
 * skill. Broken, disabled, and shadowed skills are listed too, with why. The
 * skills are the app's list, kept current by `skill.registry.changed`, so this
 * state only says where the user is.
 */
export type SkillScope = "user" | "project";

type NewForm = {
  kind: "new";
  step: "name" | "where" | "description";
  name: string;
  scope: SkillScope;
  description: string;
  error: string | null;
};

export type SkillsManagerView =
  | { kind: "list"; selected: number }
  | { kind: "detail"; path: string; selected: number }
  /** The new-skill form: name, then where, then a one-line description. */
  | NewForm
  /** `skill.create` is running. */
  | { kind: "creating"; name: string; back: NewForm };

export type SkillsManagerState = { open: boolean; view: SkillsManagerView };

/** The skills `skill.list` returned for this folder, or why it could not. */
export type SkillList = { skills: readonly ListedSkill[] | null; error: string | null };

export const closedSkillsManager: SkillsManagerState = { open: false, view: { kind: "list", selected: 0 } };

export type SkillsManagerKey =
  | "up"
  | "down"
  | "enter"
  | "back"
  | "edit"
  | "new"
  | "delete"
  | "clear"
  | number
  | { text: string };

export type SkillsManagerAction =
  | { kind: "none" }
  | { kind: "close" }
  /** Fill `/name ` in the composer. */
  | { kind: "run"; name: string }
  | { kind: "pin"; name: string; pin: boolean }
  /** Open the skill's `SKILL.md` in `$EDITOR`. `path` is the skill's folder. */
  | { kind: "edit"; path: string }
  /** Copy a bundled skill to `~/.golem/skills`, then edit the copy. */
  | { kind: "copy"; name: string }
  | { kind: "set-disabled"; name: string; disabled: boolean }
  | { kind: "reveal"; path: string }
  | { kind: "create"; name: string; scope: SkillScope; description: string };

/** The same row shape as the MCP manager, so one component draws both. */
export type SkillsManagerLine = McpManagerLine;

/** One numbered action in a skill's detail. */
export type SkillChoice = { label: string; action: SkillsManagerAction };

export const SKILLS_HINT =
  "Add one as ~/.golem/skills/<name>/SKILL.md, or .agents/skills/<name>/SKILL.md in a project.";
const LIST_HINT = "↑/↓ to navigate · Enter to open · n new skill · e edit · Esc to close";
const DETAIL_HINT = "↑/↓ to navigate · Enter to select · Esc to go back";
const TYPING_HINT = "Enter next · Esc back";
const WHERE_HINT = "↑/↓ to choose · Enter next · Esc back";
const CREATING_HINT = "Esc does nothing until it is made";
const GROUPS = { project: "This project", user: "Yours", bundled: "Bundled with golem" } as const;
const MAX_NAME = 64;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function openSkillsManager(): SkillsManagerState {
  return { open: true, view: { kind: "list", selected: 0 } };
}

/** The new-skill form, on its first step. */
export function openNewSkill(): SkillsManagerState {
  return { open: true, view: blankForm() };
}

function blankForm(): NewForm {
  return { kind: "new", step: "name", name: "", scope: "user", description: "", error: null };
}

/** The name and description steps take text, so letters are not shortcuts there. */
export function skillsManagerTyping(state: SkillsManagerState): boolean {
  return state.view.kind === "new" && state.view.step !== "where";
}

export function skillsManagerKeyOf(press: Press, typing = false): SkillsManagerKey | null {
  if (press.name === "up" || press.name === "down") {
    return typing ? null : press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "back";
  }
  if (typing) {
    if (press.name === "backspace") {
      return "delete";
    }
    if (press.name === "ctrl-u" || press.name === "ctrl-w") {
      return "clear";
    }
    const text = press.input.replace(/[\r\n]/g, "");
    if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && text.length > 0) {
      return { text };
    }
    return null;
  }
  if (!press.ctrl && !press.meta && /^[1-9]$/.test(press.input)) {
    return Number(press.input);
  }
  if (!press.ctrl && !press.meta && press.input === "e") {
    return "edit";
  }
  if (!press.ctrl && !press.meta && press.input === "n") {
    return "new";
  }
  return null;
}

/** The actions in a skill's detail, in order. The number keys pick them. */
export function skillChoices(skill: ListedSkill, pinned: readonly string[]): SkillChoice[] {
  const choices: SkillChoice[] = [];
  if (skill.usable && skill.user_invocable !== false) {
    choices.push({ label: "Run in this chat", action: { kind: "run", name: skill.name } });
  }
  if (skill.usable) {
    const pin = !pinned.includes(skill.name);
    choices.push({
      label: pin ? "Pin in this chat" : "Unpin from this chat",
      action: { kind: "pin", name: skill.name, pin },
    });
  }
  choices.push(
    skill.source === "bundled"
      ? { label: "Copy to Yours", action: { kind: "copy", name: skill.name } }
      : { label: "Edit SKILL.md", action: { kind: "edit", path: skill.path } },
  );
  const turnOff = skill.disabled !== true;
  choices.push({
    label: turnOff ? "Turn off" : "Turn on",
    action: { kind: "set-disabled", name: skill.name, disabled: turnOff },
  });
  choices.push({ label: "Reveal the folder", action: { kind: "reveal", path: skill.path } });
  return choices;
}

/** After `skill.create` failed: the form again, with why. */
export function skillCreateFailed(state: SkillsManagerState, message: string): SkillsManagerState {
  if (state.view.kind !== "creating") {
    return state;
  }
  return { ...state, view: { ...state.view.back, error: message } };
}

/** Show a skill's detail, such as after it was edited, copied, or created. */
export function showSkillDetail(state: SkillsManagerState, path: string): SkillsManagerState {
  return { ...state, open: true, view: { kind: "detail", path, selected: 0 } };
}

/** What is wrong with a skill name, or null. The daemon checks again. */
export function skillNameError(name: string): string | null {
  if (name.length === 0) {
    return "Give it a name.";
  }
  if (name.length > MAX_NAME || !NAME.test(name)) {
    return `Use up to ${MAX_NAME} lowercase letters, digits and single dashes, such as pdf-tools.`;
  }
  return null;
}

export function pressSkillsManager(
  state: SkillsManagerState,
  skills: readonly ListedSkill[],
  key: SkillsManagerKey,
  pinned: readonly string[] = [],
): { state: SkillsManagerState; action: SkillsManagerAction } {
  const none = { kind: "none" } as const;
  const view = state.view;
  if (view.kind === "creating") {
    return { state, action: none };
  }
  if (view.kind === "new") {
    return pressNew(state, view, key);
  }
  if (view.kind === "list") {
    const selected = clamp(view.selected, skills.length);
    if (key === "back") {
      return { state: closedSkillsManager, action: { kind: "close" } };
    }
    if (key === "new") {
      return { state: { ...state, view: blankForm() }, action: none };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), skills.length);
      return { state: { ...state, view: { kind: "list", selected: next } }, action: none };
    }
    const skill = skills[selected];
    if (key === "edit" && skill !== undefined && skill.source !== "bundled") {
      return { state, action: { kind: "edit", path: skill.path } };
    }
    if (key === "enter" && skill !== undefined) {
      return { state: { ...state, view: { kind: "detail", path: skill.path, selected: 0 } }, action: none };
    }
    return { state, action: none };
  }
  const index = skills.findIndex((item) => item.path === view.path);
  const skill = skills[index];
  if (key === "back" || skill === undefined) {
    return { state: { ...state, view: { kind: "list", selected: Math.max(0, index) } }, action: none };
  }
  const choices = skillChoices(skill, pinned);
  if (key === "up" || key === "down") {
    const selected = clamp(view.selected + (key === "up" ? -1 : 1), choices.length);
    return { state: { ...state, view: { ...view, selected } }, action: none };
  }
  const picked =
    key === "enter" ? choices[clamp(view.selected, choices.length)] : typeof key === "number" ? choices[key - 1] : undefined;
  return { state, action: picked?.action ?? none };
}

function pressNew(
  state: SkillsManagerState,
  view: NewForm,
  key: SkillsManagerKey,
): { state: SkillsManagerState; action: SkillsManagerAction } {
  const none = { kind: "none" } as const;
  const at = (next: SkillsManagerView) => ({ state: { ...state, view: next }, action: none });
  if (view.step === "where") {
    if (key === "up" || key === "down") {
      return at({ ...view, scope: view.scope === "user" ? "project" : "user" });
    }
    if (key === 1 || key === 2) {
      return at({ ...view, scope: key === 1 ? "user" : "project" });
    }
    if (key === "back") {
      return at({ ...view, step: "name", error: null });
    }
    return key === "enter" ? at({ ...view, step: "description", error: null }) : { state, action: none };
  }
  const field = view.step === "name" ? view.name : view.description;
  const withField = (value: string): NewForm =>
    view.step === "name" ? { ...view, name: value, error: null } : { ...view, description: value, error: null };
  if (typeof key === "object") {
    return at(withField(field + key.text));
  }
  if (key === "delete") {
    return at(withField([...field].slice(0, -1).join("")));
  }
  if (key === "clear") {
    return at(withField(""));
  }
  if (key === "back") {
    if (view.step === "description") {
      return at({ ...view, step: "where", error: null });
    }
    return at({ kind: "list", selected: 0 });
  }
  if (key !== "enter") {
    return { state, action: none };
  }
  if (view.step === "name") {
    const name = view.name.trim();
    const error = skillNameError(name);
    return at(error === null ? { ...view, name, step: "where", error: null } : { ...view, error });
  }
  const description = view.description.trim().replace(/\s+/g, " ");
  if (description.length === 0) {
    return at({ ...view, error: "Describe it in one line: the model reads it to decide when the skill fits." });
  }
  const back = { ...view, description, error: null };
  return {
    state: { ...state, view: { kind: "creating", name: view.name, back } },
    action: { kind: "create", name: view.name, scope: view.scope, description },
  };
}

export function layoutSkillsManager(input: {
  state: SkillsManagerState;
  skills: readonly ListedSkill[] | null;
  error: string | null;
  cwd: string;
  home: string;
  columns: number;
  rows: number;
  /** The skills pinned in this chat, for the Pin / Unpin action. */
  pinned?: readonly string[];
}): SkillsManagerLine[] {
  const { state, home } = input;
  const width = Math.max(1, input.columns);
  const room = Math.max(0, input.rows - 2);
  let body: SkillsManagerLine[];
  let hint = LIST_HINT;
  const view = state.view;
  if (view.kind === "new" || view.kind === "creating") {
    const form = formLines(view, input.cwd, home, width);
    body = form.lines;
    hint = form.hint;
  } else if (input.error !== null) {
    body = [{ text: "Skills", bold: true }, { text: "" }, { text: input.error }];
  } else if (input.skills === null) {
    body = [{ text: "Skills", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else if (view.kind === "list") {
    body = scrollToSelected(listLines(input.skills, view.selected, input.cwd, home), room);
  } else {
    const skill = input.skills.find((item) => item.path === view.path);
    if (skill === undefined) {
      body = scrollToSelected(listLines(input.skills, 0, input.cwd, home), room);
    } else {
      body = scrollToSelected(detailLines(skill, view.selected, input.pinned ?? [], home, width), room);
      hint = DETAIL_HINT;
    }
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

function formLines(
  view: NewForm | Extract<SkillsManagerView, { kind: "creating" }>,
  cwd: string,
  home: string,
  width: number,
): { lines: SkillsManagerLine[]; hint: string } {
  if (view.kind === "creating") {
    return {
      lines: [{ text: `New skill · ${view.name}`, bold: true }, { text: "" }, { text: "making it…", dim: true }],
      hint: CREATING_HINT,
    };
  }
  const folders = {
    user: "Yours (~/.golem/skills)",
    project: `This project (${shortPath(`${cwd}/.agents/skills`, home)})`,
  } as const;
  const step = view.step === "name" ? 1 : view.step === "where" ? 2 : 3;
  const lines: SkillsManagerLine[] = [{ text: `New skill · ${step} of 3`, bold: true }, { text: "" }];
  const cursor = (on: boolean) => (on ? "❯ " : "  ");
  lines.push({ prefix: cursor(step === 1), text: `Name:        ${view.name}` });
  if (step === 1) {
    lines.push({ text: "Lowercase letters, digits and dashes. It becomes /name.", dim: true });
  }
  if (step === 2) {
    lines.push({ text: "  Where:" });
    (["user", "project"] as const).forEach((scope, index) => {
      const on = view.scope === scope;
      lines.push({ prefix: cursor(on), text: `${index + 1}. ${folders[scope]}`, selected: on });
    });
  }
  if (step === 3) {
    lines.push({ text: `  Where:       ${folders[view.scope]}` });
    lines.push({ prefix: "❯ ", text: `Description: ${view.description}` });
    lines.push({ text: "One line. The model reads it to decide when the skill fits.", dim: true });
  }
  if (view.error !== null) {
    lines.push({ text: "" });
    wrap(view.error, Math.max(10, width - 2)).forEach((part, index) => {
      lines.push(index === 0 ? { text: part, mark: { text: "✘", tone: "bad" } } : { text: `  ${part}` });
    });
  }
  return { lines, hint: step === 2 ? WHERE_HINT : TYPING_HINT };
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

function detailLines(
  skill: ListedSkill,
  selected: number,
  pinned: readonly string[],
  home: string,
  width: number,
): SkillsManagerLine[] {
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
  const choices = skillChoices(skill, pinned);
  const chosen = clamp(selected, choices.length);
  lines.push({ text: "" });
  choices.forEach((choice, index) => {
    lines.push({ text: `${index === chosen ? "❯ " : "  "}${index + 1}. ${choice.label}`, selected: index === chosen });
  });
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
