import { RpcError, type ListedSkill, type SkillCreateResult, type SkillIssue, type SkillReadResult, type SkillWriteResult } from "@golem/client";

export type { ListedSkill, SkillCreateResult, SkillIssue, SkillReadResult, SkillWriteResult };

/** The query key of `skill.list`. The pushed `skill.registry.changed` marks it stale. */
export const SKILL_LIST_KEY = ["skill.list"] as const;

const INVALID_PARAMS = -32602;

/** What a person does about a project skill the browser may not write. */
export const UNTRUSTED_SKILL_TEXT = "Trust this project to edit its skills from the browser, or edit it in the terminal.";

/** The daemon refused a write to a project skill because the project is not in `trusted_projects`. */
export function isUntrustedProject(error: unknown): boolean {
  return error instanceof RpcError && error.code === INVALID_PARAMS && error.message.includes("is not in trusted_projects");
}

/** One line for a skill call the daemon refused: the trust refusal in plain words, else the daemon's own reason. */
export function skillErrorText(error: unknown, fallback: string): string {
  if (isUntrustedProject(error)) return UNTRUSTED_SKILL_TEXT;
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** A skill folder's name: lowercase letters, digits and dashes, as the daemon checks it. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
