import type { ListedSkill } from "../../protocol/gen/skill-list-result.ts";

const EMPTY = "no skills here. Add one as ~/.golem/skills/<name>/SKILL.md, or .agents/skills/<name>/SKILL.md in a project.";

/**
 * One row per skill this folder sees, highest source first: a mark, the name,
 * where it comes from, and the description or why it is not used. With
 * `columns`, each row is cut to fit a terminal that wide.
 */
export function formatSkills(skills: readonly ListedSkill[], home: string, columns?: number): string {
  if (skills.length === 0) {
    return EMPTY;
  }
  const nameWidth = Math.max(...skills.map((skill) => skill.name.length));
  const sourceWidth = Math.max(...skills.map((skill) => skill.source.length));
  return skills
    .map((skill) => `${mark(skill)} ${skill.name.padEnd(nameWidth)}  ${skill.source.padEnd(sourceWidth)}  ${why(skill, home)}`)
    .map((row) => (columns === undefined || row.length <= columns ? row : `${row.slice(0, Math.max(0, columns - 1))}…`))
    .join("\n");
}

function mark(skill: ListedSkill): string {
  if ((skill.errors ?? []).length > 0) {
    return "✘";
  }
  if (!skill.usable) {
    return "–";
  }
  return (skill.warnings ?? []).length > 0 ? "!" : "✔";
}

function why(skill: ListedSkill, home: string): string {
  const errors = skill.errors ?? [];
  if (errors.length > 0) {
    return `broken: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`;
  }
  if (skill.disabled) {
    return "disabled in config.toml";
  }
  if (skill.shadowed_by) {
    return `hidden by ${shortPath(skill.shadowed_by, home)}`;
  }
  return skill.description.trim().split("\n")[0] ?? "";
}

function shortPath(path: string, home: string): string {
  return home.length > 0 && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
