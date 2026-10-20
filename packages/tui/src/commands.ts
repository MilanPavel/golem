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
  | { kind: "send"; text: string; debug: DebugState }
  | { kind: "sessions" }
  | { kind: "permissions" }
  | { kind: "new" }
  | { kind: "fork" }
  | { kind: "title"; title: string | null }
  | { kind: "close-session" }
  | { kind: "copy"; code: boolean }
  | { kind: "artifact"; id: string | null }
  | { kind: "export"; path: string | null }
  | { kind: "time" }
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
  run: (debug: DebugState, args: readonly string[]) => ComposerOutcome;
};

const UNKNOWN = "unknown command \u2014 /help lists them";

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
];

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

export function applyComposer(debug: DebugState, raw: string): ComposerOutcome {
  const text = raw.trim();
  if (text.length === 0) {
    return { kind: "idle" };
  }
  if (text.startsWith("//")) {
    return sendOrPreview(debug, text.slice(2).trim());
  }
  if (text.startsWith("/")) {
    return applyCommand(debug, text);
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

function applyCommand(debug: DebugState, text: string): ComposerOutcome {
  const [name, ...args] = text.split(/\s+/);
  const command = COMMANDS.find((candidate) => candidate.name === name);
  return command === undefined ? unknown() : command.run(debug, args);
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

function fitLine(text: string, columns: number): string {
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
