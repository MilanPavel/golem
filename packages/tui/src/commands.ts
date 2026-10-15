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
  | { kind: "send"; text: string; debug: DebugState }
  | { kind: "sessions" }
  | { kind: "new" }
  | { kind: "title"; title: string | null }
  | {
      kind: "local";
      debug: DebugState;
      notice: string | null;
      restore: string | null;
      refreshModel: boolean;
    };

type Command = {
  name: string;
  run: (debug: DebugState, args: readonly string[]) => ComposerOutcome;
};

const UNKNOWN = "unknown command";

/** Every slash command. A name not in this table is an unknown command, not a message. */
const COMMANDS: readonly Command[] = [
  { name: "/debug", run: debugCommand },
  { name: "/sessions", run: withoutArgs({ kind: "sessions" }) },
  { name: "/new", run: withoutArgs({ kind: "new" }) },
  { name: "/title", run: (_debug, args) => ({ kind: "title", title: args.length === 0 ? null : args.join(" ") }) },
];

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

function local(
  debug: DebugState,
  restore: string | null,
  refreshModel: boolean,
  notice: string | null = null,
): ComposerOutcome {
  return { kind: "local", debug, notice, restore, refreshModel };
}
