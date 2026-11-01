import type { ListedSkill } from "@golem/client";

export type DebugTab = "wire" | "model";

export type DebugState = {
  open: boolean;
  tab: DebugTab;
  hold: boolean;
  held: string | null;
};

export const closedDebug: DebugState = {
  open: false,
  tab: "wire",
  hold: false,
  held: null,
};

export type ComposerOutcome =
  | { kind: "idle" }
  | { kind: "unknown"; notice: string }
  | { kind: "help" }
  | { kind: "mcp" }
  | { kind: "mcp-toggle"; on: boolean; name: string }
  | { kind: "send"; text: string; debug: DebugState }
  /** Run a skill once. `text` is the line as typed, and the daemon fills in the body from `args`. */
  | { kind: "skill"; name: string; args: string; text: string; debug: DebugState }
  /** Pin a skill for the whole session, or unpin it. */
  | { kind: "skill-pin"; pin: boolean; name: string }
  | { kind: "sessions" }
  | { kind: "skills" }
  | { kind: "permissions" }
  | { kind: "new" }
  | { kind: "fork" }
  | { kind: "title"; title: string | null }
  | { kind: "close-session" }
  | { kind: "copy"; code: boolean }
  | { kind: "artifact"; id: string | null }
  | { kind: "export"; path: string | null }
  | { kind: "time" }
  | { kind: "todos" }
  | { kind: "model"; name: string | null }
  | { kind: "model-pull"; name: string }
  | { kind: "model-rm"; name: string }
  | { kind: "login"; provider: string }
  | { kind: "logout"; provider: string }
  | {
      kind: "local";
      debug: DebugState;
      notice: string | null;
      restore: string | null;
      refreshModel: boolean;
    };

export type Command = {
  name: string;
  /** Shown after the name. Empty when the command takes nothing. */
  args: string;
  description: string;
  /** Fixed argument choices. Free text, such as a title, has none. */
  choices?: readonly string[];
  /** A skill's `argument-hint`, shown after its name in the suggestions. */
  hint?: string;
  /** Choices for the word after one of `choices`, such as the skill names after `/skill run`. */
  subChoices?: Readonly<Record<string, readonly string[]>>;
  run: (debug: DebugState, args: readonly string[]) => ComposerOutcome;
};

/** A skill you can run by name: usable, and not `user-invocable: false`. */
export type SkillChoice = {
  name: string;
  description: string;
  argumentHint: string | null;
};

/** The skills `skill.list` returned that you can run with `/name`. */
export function invocableSkills(listed: readonly ListedSkill[]): SkillChoice[] {
  return listed
    .filter((skill) => skill.usable && skill.user_invocable !== false)
    .map((skill) => ({ name: skill.name, description: skill.description, argumentHint: skill.argument_hint ?? null }));
}

/**
 * What `/skill pin` and `/skill unpin` may name: every usable skill, and the
 * ones pinned now, in pin order. A skill with `user-invocable: false` may be
 * pinned, because such skills are background knowledge.
 */
export type PinChoices = {
  pinnable: readonly string[];
  active: readonly string[];
};

const noPins: PinChoices = { pinnable: [], active: [] };

/** The names of the usable skills, for `/skill pin`. */
export function pinnableSkills(listed: readonly ListedSkill[]): string[] {
  return [...new Set(listed.filter((skill) => skill.usable).map((skill) => skill.name))];
}

/** `/skill` alone: the skills pinned in this session. */
export function pinnedNotice(active: readonly string[]): string {
  return active.length === 0
    ? "no skills pinned \u2014 /skill pin <name> pins one for this session"
    : `pinned: ${active.join(", ")}`;
}

const UNKNOWN = "unknown command \u2014 /help lists them";
const SKILL_USAGE = "/skill run <name> [args] \u00b7 /skill pin <name> \u00b7 /skill unpin <name>";
const HELD_SKILL = "a skill is not held \u2014 /debug hold turns hold off";

/** Built-in providers that take an API key. A provider added in config.toml works too. */
export const KEY_PROVIDERS: readonly string[] = ["anthropic", "groq", "openai", "openrouter", "together"];

/** Every slash command. A name not in this table is an unknown command, not a message. */
export const COMMANDS: readonly Command[] = [
  {
    name: "/artifact",
    args: "[id]",
    description: "Opens the whole output of a long tool call in $PAGER. The newest one without an id.",
    run: (_debug, args) => (args.length > 1 ? unknown() : { kind: "artifact", id: args[0] ?? null }),
  },
  {
    name: "/close",
    args: "",
    description: "Closes this session and opens another.",
    run: withoutArgs({ kind: "close-session" }),
  },
  {
    name: "/copy",
    args: "[code]",
    description: "Copies the last answer, or the last code block.",
    choices: ["code"],
    run: (_debug, args) => {
      if (args.length > 1) {
        return unknown();
      }
      const arg = args[0];
      if (arg === undefined) {
        return { kind: "copy", code: false };
      }
      return arg === "code" ? { kind: "copy", code: true } : unknown();
    },
  },
  {
    name: "/debug",
    args: "[wire|model|hold|go]",
    description: "Opens or closes the debug panel, or picks wire, model, hold, or go.",
    choices: ["wire", "model", "hold", "go"],
    run: debugCommand,
  },
  {
    name: "/export",
    args: "[path]",
    description: "Writes this session as markdown.",
    run: (_debug, args) => ({ kind: "export", path: args.length === 0 ? null : args.join(" ") }),
  },
  {
    name: "/fork",
    args: "",
    description: "Copies this session up to its newest finished message.",
    run: withoutArgs({ kind: "fork" }),
  },
  {
    name: "/help",
    args: "",
    description: "Lists every command.",
    run: withoutArgs({ kind: "help" }),
  },
  {
    name: "/login",
    args: "<provider>",
    description: "Asks for the provider's API key and saves it in the Keychain.",
    choices: KEY_PROVIDERS,
    run: providerCommand("login"),
  },
  {
    name: "/logout",
    args: "<provider>",
    description: "Removes the provider's API key from the Keychain.",
    choices: KEY_PROVIDERS,
    run: providerCommand("logout"),
  },
  {
    name: "/mcp",
    args: "[enable|disable <name>]",
    description: "Manages the MCP servers: tools, reconnect, on or off. enable|disable <name> is a shortcut.",
    choices: ["enable", "disable"],
    run: (_debug, args) => {
      const [action, name, ...extra] = args;
      if (action === undefined) {
        return { kind: "mcp" };
      }
      if ((action === "enable" || action === "disable") && name !== undefined && extra.length === 0) {
        return { kind: "mcp-toggle", on: action === "enable", name };
      }
      return { kind: "unknown", notice: "/mcp, /mcp enable <name>, or /mcp disable <name>" };
    },
  },
  {
    name: "/model",
    args: "[pull|rm] [name]",
    description: "Opens the model picker, switches this session, or downloads or removes a local model.",
    run: (_debug, args) => {
      const [first, second] = args;
      if ((first === "pull" || first === "rm") && args.length === 2 && second !== undefined) {
        return first === "pull" ? { kind: "model-pull", name: second } : { kind: "model-rm", name: second };
      }
      if (args.length > 1) {
        return unknown();
      }
      return { kind: "model", name: first ?? null };
    },
  },
  {
    name: "/new",
    args: "",
    description: "Starts a new session.",
    run: withoutArgs({ kind: "new" }),
  },
  {
    name: "/permissions",
    args: "",
    description: "Shows the tool rules for this folder and what this session allows.",
    run: withoutArgs({ kind: "permissions" }),
  },
  {
    name: "/sessions",
    args: "",
    description: "Opens the session switcher.",
    run: withoutArgs({ kind: "sessions" }),
  },
  {
    name: "/skill",
    args: "run|pin|unpin <name>",
    description: "Runs a skill once, or pins one for the whole session. Alone, lists the pinned skills.",
    choices: ["run", "pin", "unpin"],
    // The composer reads /skill itself, because a skill's arguments keep their spacing and quotes.
    run: () => ({ kind: "unknown", notice: SKILL_USAGE }),
  },
  {
    name: "/skills",
    args: "",
    description: "Lists the skills this folder sees, with broken and hidden ones and why.",
    run: withoutArgs({ kind: "skills" }),
  },
  {
    name: "/time",
    args: "",
    description: "Shows or hides the time beside each message.",
    run: withoutArgs({ kind: "time" }),
  },
  {
    name: "/title",
    args: "[name]",
    description: "Shows the title, or sets it.",
    run: (_debug, args) => ({ kind: "title", title: args.length === 0 ? null : args.join(" ") }),
  },
  {
    name: "/todos",
    args: "",
    description: "Shows or hides the agent's todo list above the composer.",
    run: withoutArgs({ kind: "todos" }),
  },
];

/**
 * `commands` with one row per skill, for suggestions, and the skill names
 * after `/skill run`, `/skill pin`, and `/skill unpin`. A built-in command
 * keeps its name, so a skill named like one is suggested only after `/skill run`.
 */
export function withSkillChoices(
  commands: readonly Command[],
  skills: readonly SkillChoice[],
  pins: PinChoices = noPins,
): Command[] {
  const taken = new Set(commands.map((command) => command.name));
  const names = skills.map((skill) => skill.name);
  const rows: Command[] = skills
    .filter((skill) => !taken.has(`/${skill.name}`))
    .map((skill) => ({
      name: `/${skill.name}`,
      args: skill.argumentHint ?? "",
      ...(skill.argumentHint === null ? {} : { hint: skill.argumentHint }),
      description: skill.description,
      run: () => unknown(),
    }));
  const withRun = commands.map((command) =>
    command.name === "/skill"
      ? {
          ...command,
          subChoices: {
            run: names,
            pin: pins.pinnable.filter((name) => !pins.active.includes(name)),
            unpin: [...pins.active],
          },
        }
      : command,
  );
  return [...withRun, ...rows];
}

/** `commands` with `/model`'s argument choices set to `names`, for suggestions. */
export function withModelChoices(commands: readonly Command[], names: readonly string[]): Command[] {
  return commands.map((command) => (command.name === "/model" ? { ...command, choices: names } : command));
}

/** One row per command. The lines are the table, and nothing is added around it. */
export function helpLines(commands: readonly Pick<Command, "name" | "args" | "description">[], columns: number): string[] {
  const usage = (command: Pick<Command, "name" | "args">): string =>
    command.args.length > 0 ? `${command.name} ${command.args}` : command.name;
  const width = commands.reduce((max, command) => Math.max(max, usage(command).length), 0);
  return commands.map((command) => fitLine(`${usage(command).padEnd(width)}  ${command.description}`, columns));
}

export function toggleDebugTab(debug: DebugState): DebugState {
  if (!debug.open) {
    return debug;
  }
  return { ...debug, tab: debug.tab === "wire" ? "model" : "wire" };
}

/**
 * What Enter does with the draft. `skills` are the ones `/name` may run, and
 * `pins` what `/skill pin` and `/skill unpin` may name. A built-in command
 * wins a name, and `/skill run <name>` always reaches the skill.
 */
export function applyComposer(
  debug: DebugState,
  raw: string,
  skills: readonly SkillChoice[] = [],
  pins: PinChoices = noPins,
): ComposerOutcome {
  const text = raw.trim();
  if (text.length === 0) {
    return { kind: "idle" };
  }
  if (text.startsWith("//")) {
    return sendOrPreview(debug, text.slice(2).trim());
  }
  if (text.startsWith("/")) {
    return applyCommand(debug, text, skills, pins);
  }
  return sendOrPreview(debug, text);
}

function sendOrPreview(debug: DebugState, text: string): ComposerOutcome {
  if (text.length === 0) {
    return { kind: "idle" };
  }
  if (debug.hold) {
    return {
      kind: "local",
      debug: { ...debug, open: true, tab: "model", hold: true, held: text },
      notice: null,
      restore: null,
      refreshModel: true,
    };
  }
  return { kind: "send", text, debug };
}

function applyCommand(
  debug: DebugState,
  text: string,
  skills: readonly SkillChoice[],
  pins: PinChoices,
): ComposerOutcome {
  const [name = "", ...args] = text.split(/\s+/);
  if (name === "/skill") {
    return skillCommand(debug, text, skills, pins);
  }
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (command !== undefined) {
    return command.run(debug, args);
  }
  const skill = skills.find((candidate) => `/${candidate.name}` === name);
  return skill === undefined ? unknown() : runSkill(debug, skill.name, afterWords(text, 1), text);
}

/** `/skill` alone, `/skill run <name> [args]`, `/skill pin <name>`, and `/skill unpin <name>`. */
function skillCommand(
  debug: DebugState,
  text: string,
  skills: readonly SkillChoice[],
  pins: PinChoices,
): ComposerOutcome {
  const [, sub, name, extra] = text.split(/\s+/);
  if (sub === undefined) {
    return local(debug, null, false, pinnedNotice(pins.active));
  }
  if (sub === "pin" || sub === "unpin") {
    return pinCommand(debug, sub === "pin", name, extra, pins);
  }
  if (sub !== "run" || name === undefined) {
    return { kind: "unknown", notice: SKILL_USAGE };
  }
  if (!skills.some((skill) => skill.name === name)) {
    return { kind: "unknown", notice: `no skill named ${name} to run \u2014 /skills lists them` };
  }
  return runSkill(debug, name, afterWords(text, 3), text);
}

function pinCommand(
  debug: DebugState,
  pin: boolean,
  name: string | undefined,
  extra: string | undefined,
  pins: PinChoices,
): ComposerOutcome {
  const verb = pin ? "pin" : "unpin";
  if (name === undefined || extra !== undefined) {
    return { kind: "unknown", notice: `/skill ${verb} takes one skill name` };
  }
  const pinned = pins.active.includes(name);
  if (pin && pinned) {
    return local(debug, null, false, `${name} is already pinned`);
  }
  if (pin && !pins.pinnable.includes(name)) {
    return { kind: "unknown", notice: `no skill named ${name} to pin \u2014 /skills lists them` };
  }
  if (!pin && !pinned) {
    return local(debug, null, false, `${name} is not pinned \u2014 ${pinnedNotice(pins.active)}`);
  }
  return { kind: "skill-pin", pin, name };
}

function runSkill(debug: DebugState, name: string, args: string, text: string): ComposerOutcome {
  if (debug.hold) {
    return local(debug, null, false, HELD_SKILL);
  }
  return { kind: "skill", name, args, text, debug };
}

/** `text` after its first `count` words, with the spacing and quotes inside kept. */
function afterWords(text: string, count: number): string {
  let rest = text;
  for (let word = 0; word < count; word += 1) {
    rest = rest.replace(/^\s*\S+/, "");
  }
  return rest.trim();
}

function providerCommand(kind: "login" | "logout"): Command["run"] {
  return (_debug, args) => {
    const provider = args[0];
    if (args.length !== 1 || provider === undefined || provider.length === 0) {
      return { kind: "unknown", notice: `/${kind} needs a provider, for example /${kind} anthropic` };
    }
    return { kind, provider };
  };
}

function withoutArgs(outcome: ComposerOutcome): Command["run"] {
  return (_debug, args) => (args.length === 0 ? outcome : unknown());
}

function unknown(): ComposerOutcome {
  return { kind: "unknown", notice: UNKNOWN };
}

function debugCommand(debug: DebugState, args: readonly string[]): ComposerOutcome {
  if (args.length > 1) {
    return unknown();
  }
  const arg = args[0];
  if (arg === undefined) {
    if (debug.open) {
      return local({ ...debug, open: false }, null, false);
    }
    return local({ ...debug, open: true, tab: "wire" }, null, true);
  }
  if (arg === "wire") {
    return local({ ...debug, open: true, tab: "wire" }, null, true);
  }
  if (arg === "model") {
    return local({ ...debug, open: true, tab: "model" }, null, true);
  }
  if (arg === "hold") {
    if (debug.hold) {
      return local({ ...debug, hold: false, held: null }, debug.held, false);
    }
    return local({ ...debug, open: true, tab: "model", hold: true }, null, true);
  }
  if (arg === "go") {
    if (debug.held === null || debug.held.length === 0) {
      return local(debug, null, false, "nothing held");
    }
    return {
      kind: "send",
      text: debug.held,
      debug: { ...debug, hold: false, held: null },
    };
  }
  return unknown();
}

export function fitLine(text: string, columns: number): string {
  if (columns <= 0) {
    return "";
  }
  if (text.length <= columns) {
    return text;
  }
  if (columns === 1) {
    return "\u2026";
  }
  return `${text.slice(0, columns - 1)}\u2026`;
}

function local(
  debug: DebugState,
  restore: string | null,
  refreshModel: boolean,
  notice: string | null = null,
): ComposerOutcome {
  return { kind: "local", debug, notice, restore, refreshModel };
}
