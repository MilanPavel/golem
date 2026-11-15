import type { ListedSkill } from "@golem/client";

import { shortPath, type McpTone } from "./mcp-servers.ts";

/** What `/skills` and the Skills page say about a skill, as words and data: the TUI lays it out, the page draws it. */
export const SKILLS_HINT =
  "Add one as ~/.golem/skills/<name>/SKILL.md, or .agents/skills/<name>/SKILL.md in a project.";

/** The group titles, by where a skill comes from. */
export const GROUPS = { project: "This project", user: "Yours", bundled: "Bundled with golem" } as const;

/** The glyph and tone of a skill. The word goes with it, so colour is never alone. */
export function skillMark(skill: ListedSkill): { text: string; tone: McpTone } {
  if ((skill.errors ?? []).length > 0) {
    return { text: "✘", tone: "bad" };
  }
  if (skill.usable) {
    const warned = (skill.warnings ?? []).length > 0;
    return { text: warned ? "!" : "✔", tone: warned ? "wait" : "ok" };
  }
  return { text: "–", tone: "off" };
}

/** Why a skill is, or is not, in use. */
export function skillStatusWord(skill: ListedSkill, home: string): string {
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

/** The one line under a skill's name in the list. */
export function skillSummary(skill: ListedSkill, home: string): string {
  if ((skill.errors ?? []).length > 0) {
    return skill.errors?.[0] ?? "";
  }
  if (skill.disabled) {
    return "disabled in config.toml";
  }
  if (skill.shadowed_by) {
    return `hidden by ${shortPath(skill.shadowed_by, home)}`;
  }
  return skill.description.trim().split("\n")[0] ?? "";
}

/** How you run it: `/name [hint]`. */
export function skillRunAs(skill: ListedSkill): string {
  return skill.argument_hint ? `/${skill.name} ${skill.argument_hint}` : `/${skill.name}`;
}

/** The detail rows, in order. Rows with nothing to say are left out. */
export function skillFacts(skill: ListedSkill, home: string): { label: string; text: string }[] {
  const facts = [
    { label: "Status", text: skillStatusWord(skill, home) },
    { label: "From", text: GROUPS[skill.source] },
    { label: "Folder", text: shortPath(skill.path, home) },
  ];
  if (skill.description.length > 0) {
    facts.push({ label: "Description", text: skill.description });
  }
  facts.push({ label: "You run it", text: skill.user_invocable === false ? "no" : skillRunAs(skill) });
  facts.push({ label: "Model uses it", text: skill.model_invocable === false ? "no, only you" : "when it fits" });
  if ((skill.allowed_tools ?? []).length > 0) {
    facts.push({ label: "Allowed tools", text: (skill.allowed_tools ?? []).join(", ") });
  }
  if (skill.model) {
    facts.push({ label: "Model", text: `${skill.model} (not used yet)` });
  }
  return facts;
}

/** The errors, then the warnings. */
export function skillIssues(skill: ListedSkill): { tone: "bad" | "wait"; text: string }[] {
  return [
    ...(skill.errors ?? []).map((text) => ({ tone: "bad" as const, text })),
    ...(skill.warnings ?? []).map((text) => ({ tone: "wait" as const, text })),
  ];
}
