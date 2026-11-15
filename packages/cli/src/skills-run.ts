import type { GolemClient } from "@golem/client";

/** What `golem skills new` and `golem skills edit` need from outside: the editor, the check, and the terminal. */
export interface SkillsDeps {
  /** The project folder. */
  cwd: string;
  /** Opens the file in the editor. False when the editor failed. */
  editFile(path: string): Promise<boolean>;
  /** The same check as `golem skills check <path>`: prints its errors, and returns its exit code. */
  check(path: string): Promise<number>;
  write(line: string): void;
  error(line: string): void;
}

export interface SkillsNewArgs {
  name: string;
  project: boolean;
  description: string | null;
}

/** `<name> [--project] [--description "…"]`, or null when it does not fit. */
export function parseSkillsNew(args: readonly string[]): SkillsNewArgs | null {
  let name: string | null = null;
  let project = false;
  let description: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--project") {
      project = true;
    } else if (arg === "--description") {
      const value = args[i + 1];
      if (value === undefined || value.trim() === "") return null;
      description = value;
      i += 1;
    } else if (arg.startsWith("-") || name !== null) {
      return null;
    } else {
      name = arg;
    }
  }
  return name === null ? null : { name, project, description };
}

/** `skill.create` needs a description; this one is for the person to replace in the editor. */
const PLACEHOLDER_DESCRIPTION = "TODO: say what this skill does and when to use it";

/** Opens the skill's own file, then checks it. The editor changes the file itself, so there is no write to refuse. */
async function openAndCheck(path: string, deps: SkillsDeps): Promise<number> {
  if (!(await deps.editFile(path))) {
    deps.error(`the editor did not finish: ${path} is as the editor left it`);
    return 1;
  }
  return deps.check(path);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `golem skills edit <name>`: the skill's `SKILL.md` in `$EDITOR`, then `golem skills check` on it. */
export async function runSkillsEdit(client: GolemClient, name: string, deps: SkillsDeps): Promise<number> {
  let path: string;
  try {
    const read = await client.readSkill(name, deps.cwd);
    if (read.source === "bundled") {
      deps.error(`${name} is bundled with golem and read-only: copy it with \`golem skills new\` to change it`);
      return 1;
    }
    path = read.path;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
  return openAndCheck(path, deps);
}

/** `golem skills new <name>`: make the skill (this folder is the project with `--project`), then open it as `edit` does. */
export async function runSkillsNew(client: GolemClient, args: SkillsNewArgs, deps: SkillsDeps): Promise<number> {
  let path: string;
  try {
    const made = await client.createSkill(
      {
        name: args.name,
        scope: args.project ? "project" : "user",
        cwd: deps.cwd,
        description: args.description ?? PLACEHOLDER_DESCRIPTION,
      },
      { local: true },
    );
    path = made.path;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
  deps.write(`created ${path}`);
  return openAndCheck(path, deps);
}
