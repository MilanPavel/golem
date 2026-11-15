import type { ListedSkill } from "../../../store/skills.ts";

/** Skills as the gallery shows them: one of each kind of row. */
export const SAMPLE_SKILLS: ListedSkill[] = [
  { name: "ship", description: "Take the local changes to an open pull request.", source: "project", path: "/Users/you/repos/golem/.agents/skills/ship", usable: true, argument_hint: "[hint]", allowed_tools: ["Bash(git *)", "Read"], indexed: true },
  { name: "morning-brief", description: "Summarise what changed overnight.", source: "user", path: "/Users/you/.golem/skills/morning-brief", usable: true, argument_hint: "[repo]", warnings: ["`context` is not supported yet, so it is ignored"] },
  { name: "sentry-triage", description: "Sort new Sentry issues.", source: "user", path: "/Users/you/.golem/skills/sentry-triage", usable: false, disabled: true },
  { name: "broken-one", description: "", source: "user", path: "/Users/you/.golem/skills/broken-one", usable: false, errors: ["the frontmatter is not valid YAML: line 3: expected ',' or ']'"] },
  { name: "ship", description: "My own ship.", source: "user", path: "/Users/you/.golem/skills/ship", usable: false, shadowed_by: "/Users/you/repos/golem/.agents/skills/ship" },
  { name: "release-notes", description: "Write release notes.", source: "bundled", path: "/app/skills/release-notes", usable: true, argument_hint: "[since]", model_invocable: false },
];

/** A SKILL.md with the YAML mistake the error strip points at. */
export const SAMPLE_BROKEN_SKILL_MD = `---
name: broken-one
allowed-tools: [Read, Grep, Bash(git log:*)
description: Summarise what changed since the last release tag.
---

# Broken one

Run \`git log --oneline\` from the last tag to HEAD, then group the commits by area.
`;
