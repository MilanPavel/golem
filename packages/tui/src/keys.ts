/** Where a binding applies. The overlay groups rows by these names. */
export type KeyContext = "composer" | "transcript" | "switcher" | "debug";

export const KEY_CONTEXTS: readonly KeyContext[] = ["composer", "transcript", "switcher", "debug"];

export type PressName =
  | "ctrl-c"
  | "f1"
  | "question"
  | "escape"
  | "page-up"
  | "page-down"
  | "home"
  | "end"
  | "tab"
  | "return"
  | "backspace"
  | "up"
  | "down";

export type Press = {
  name: PressName | null;
  input: string;
  ctrl: boolean;
  meta: boolean;
};

/** The flags Ink reports. Extra flags on Ink's Key are ignored. */
export type KeyFlags = {
  upArrow: boolean;
  downArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

export type KeyPlace = {
  overlay: boolean;
  help: boolean;
  switcher: boolean;
  debug: boolean;
  draftEmpty: boolean;
  busy: boolean;
  connected: boolean;
  suggestions: boolean;
};

export type ScrollToward = "up" | "down" | "start" | "end";

export type KeyEffect =
  | { kind: "cancel" }
  | { kind: "toggle-overlay" }
  | { kind: "close-overlay" }
  | { kind: "close-help" }
  | { kind: "scroll-overlay"; toward: ScrollToward }
  | { kind: "scroll"; target: "debug" | "transcript"; toward: ScrollToward }
  | { kind: "close-debug" }
  | { kind: "debug-tab" }
  | { kind: "switcher"; key: "up" | "down" | "enter" | "new" | "close" }
  | { kind: "suggest"; key: "up" | "down" | "tab" | "enter" | "close" }
  | { kind: "submit" }
  | { kind: "backspace" }
  | { kind: "insert"; text: string }
  | { kind: "ignore" };

type KeyWhen = {
  name?: PressName;
  input?: string;
  overlay?: boolean;
  help?: boolean;
  switcher?: boolean;
  debug?: boolean;
  draftEmpty?: boolean;
  busy?: boolean;
  connected?: boolean;
  suggestions?: boolean;
};

export type KeyBinding = {
  id: string;
  label: string;
  contexts: readonly KeyContext[];
  description: string;
  when: KeyWhen;
  run: (place: KeyPlace) => KeyEffect;
};

const scrollChat =
  (toward: ScrollToward) =>
  (place: KeyPlace): KeyEffect => {
    if (place.overlay) {
      return { kind: "scroll-overlay", toward };
    }
    if (place.switcher) {
      return { kind: "ignore" };
    }
    if (place.debug) {
      return { kind: "scroll", target: "debug", toward };
    }
    return { kind: "scroll", target: "transcript", toward };
  };

/**
 * Every key the screen handles. First match wins, so a tighter `when` stays above a looser one.
 * `?` and F1 open the overlay; Esc or `?` closes it.
 */
export const KEYS: readonly KeyBinding[] = [
  {
    id: "cancel",
    label: "Ctrl-C",
    contexts: KEY_CONTEXTS,
    description: "Cancels the answer. A second press quits.",
    when: { name: "ctrl-c" },
    run: () => ({ kind: "cancel" }),
  },
  {
    id: "keys",
    label: "F1",
    contexts: KEY_CONTEXTS,
    description: "Shows or hides the key list.",
    when: { name: "f1" },
    run: () => ({ kind: "toggle-overlay" }),
  },
  {
    id: "close-keys-esc",
    label: "Esc",
    contexts: KEY_CONTEXTS,
    description: "Closes the key list.",
    when: { name: "escape", overlay: true },
    run: () => ({ kind: "close-overlay" }),
  },
  {
    id: "close-keys-question",
    label: "?",
    contexts: KEY_CONTEXTS,
    description: "Closes the key list.",
    when: { name: "question", overlay: true },
    run: () => ({ kind: "close-overlay" }),
  },
  {
    id: "suggest-up",
    label: "Up",
    contexts: ["composer"],
    description: "While suggestions are open, moves the selection up.",
    when: { name: "up", overlay: false, switcher: false, suggestions: true },
    run: () => ({ kind: "suggest", key: "up" }),
  },
  {
    id: "suggest-down",
    label: "Down",
    contexts: ["composer"],
    description: "While suggestions are open, moves the selection down.",
    when: { name: "down", overlay: false, switcher: false, suggestions: true },
    run: () => ({ kind: "suggest", key: "down" }),
  },
  {
    id: "suggest-close",
    label: "Esc",
    contexts: ["composer"],
    description: "Closes command suggestions and keeps the draft.",
    when: { name: "escape", overlay: false, suggestions: true },
    run: () => ({ kind: "suggest", key: "close" }),
  },
  {
    id: "suggest-tab",
    label: "Tab",
    contexts: ["composer"],
    description: "Fills in the selected command or argument.",
    when: { name: "tab", overlay: false, switcher: false, suggestions: true },
    run: () => ({ kind: "suggest", key: "tab" }),
  },
  {
    id: "suggest-enter",
    label: "Enter",
    contexts: ["composer"],
    description: "Fills in a partial command, or sends a finished one.",
    when: { name: "return", overlay: false, switcher: false, suggestions: true },
    run: () => ({ kind: "suggest", key: "enter" }),
  },
  {
    id: "page-up",
    label: "Page Up",
    contexts: ["transcript", "debug"],
    description: "Scrolls toward older lines, or this list when it is open.",
    when: { name: "page-up" },
    run: scrollChat("up"),
  },
  {
    id: "page-down",
    label: "Page Down",
    contexts: ["transcript", "debug"],
    description: "Scrolls toward newer lines, or this list when it is open.",
    when: { name: "page-down" },
    run: scrollChat("down"),
  },
  {
    id: "home",
    label: "Home",
    contexts: ["transcript", "debug"],
    description: "Jumps to the oldest line, or the top of this list.",
    when: { name: "home" },
    run: scrollChat("start"),
  },
  {
    id: "end",
    label: "End",
    contexts: ["transcript", "debug"],
    description: "Jumps to the newest line, or the end of this list.",
    when: { name: "end" },
    run: scrollChat("end"),
  },
  {
    id: "close-help",
    label: "Esc",
    contexts: ["composer"],
    description: "Closes the command list.",
    when: { name: "escape", overlay: false, help: true },
    run: () => ({ kind: "close-help" }),
  },
  {
    id: "switcher-up",
    label: "Up",
    contexts: ["switcher"],
    description: "Moves the selection up.",
    when: { name: "up", overlay: false, switcher: true },
    run: () => ({ kind: "switcher", key: "up" }),
  },
  {
    id: "switcher-down",
    label: "Down",
    contexts: ["switcher"],
    description: "Moves the selection down.",
    when: { name: "down", overlay: false, switcher: true },
    run: () => ({ kind: "switcher", key: "down" }),
  },
  {
    id: "switcher-enter",
    label: "Enter",
    contexts: ["switcher"],
    description: "Opens the selected session.",
    when: { name: "return", overlay: false, switcher: true },
    run: () => ({ kind: "switcher", key: "enter" }),
  },
  {
    id: "switcher-new",
    label: "n",
    contexts: ["switcher"],
    description: "Starts a new session.",
    when: { input: "n", overlay: false, switcher: true },
    run: () => ({ kind: "switcher", key: "new" }),
  },
  {
    id: "switcher-close",
    label: "Esc",
    contexts: ["switcher"],
    description: "Closes the switcher.",
    when: { name: "escape", overlay: false, help: false, switcher: true },
    run: () => ({ kind: "switcher", key: "close" }),
  },
  {
    id: "debug-close",
    label: "Esc",
    contexts: ["debug"],
    description: "Closes the debug panel.",
    when: { name: "escape", overlay: false, help: false, switcher: false, debug: true },
    run: () => ({ kind: "close-debug" }),
  },
  {
    id: "debug-tab",
    label: "Tab",
    contexts: ["debug"],
    description: "Switches the debug tab.",
    when: { name: "tab", overlay: false, switcher: false, debug: true },
    run: () => ({ kind: "debug-tab" }),
  },
  {
    id: "show-keys",
    label: "?",
    contexts: ["composer"],
    description: "On an empty line, shows the key list.",
    when: { name: "question", overlay: false, switcher: false, draftEmpty: true, busy: false },
    run: () => ({ kind: "toggle-overlay" }),
  },
  {
    id: "send",
    label: "Enter",
    contexts: ["composer"],
    description: "Sends the message.",
    when: { name: "return", overlay: false, switcher: false, connected: true },
    run: () => ({ kind: "submit" }),
  },
  {
    id: "backspace",
    label: "Backspace",
    contexts: ["composer"],
    description: "Deletes the last character.",
    when: { name: "backspace", overlay: false, switcher: false, busy: false, connected: true },
    run: () => ({ kind: "backspace" }),
  },
];

export type OverlayLine = {
  text: string;
  dim: boolean;
};

/** Grouped by context. A binding is listed once for each context it names. */
export function keyOverlayLines(keys: readonly KeyBinding[], columns: number): OverlayLine[] {
  const lines: OverlayLine[] = [];
  for (const context of KEY_CONTEXTS) {
    const group = keys.filter((key) => key.contexts.includes(context));
    if (group.length === 0) {
      continue;
    }
    lines.push({ text: fitLine(context, columns), dim: true });
    const labelWidth = group.reduce((max, key) => Math.max(max, key.label.length), 0);
    for (const key of group) {
      lines.push({
        text: fitLine(`  ${key.label.padEnd(labelWidth)}  ${key.description}`, columns),
        dim: false,
      });
    }
  }
  return lines;
}

export function pressKey(place: KeyPlace, press: Press): KeyEffect {
  const binding = KEYS.find((key) => whenMatches(key.when, place, press));
  if (binding !== undefined) {
    return binding.run(place);
  }
  if (
    press.input.length > 0 &&
    !press.ctrl &&
    !press.meta &&
    place.connected &&
    !place.busy &&
    !place.overlay &&
    !place.switcher
  ) {
    return { kind: "insert", text: press.input };
  }
  return { kind: "ignore" };
}

export function classifyPress(input: string, key: KeyFlags): Press {
  const press: Press = { name: null, input, ctrl: key.ctrl, meta: key.meta };
  if (key.ctrl && input === "c") {
    return { ...press, name: "ctrl-c" };
  }
  if (key.pageUp) {
    return { ...press, name: "page-up" };
  }
  if (key.pageDown) {
    return { ...press, name: "page-down" };
  }
  if (key.home) {
    return { ...press, name: "home" };
  }
  if (key.end) {
    return { ...press, name: "end" };
  }
  if (key.upArrow) {
    return { ...press, name: "up" };
  }
  if (key.downArrow) {
    return { ...press, name: "down" };
  }
  if (key.escape) {
    return { ...press, name: "escape" };
  }
  if (key.tab) {
    return { ...press, name: "tab" };
  }
  if (key.return) {
    return { ...press, name: "return" };
  }
  if (key.backspace || key.delete) {
    return { ...press, name: "backspace" };
  }
  if (input === "?") {
    return { ...press, name: "question" };
  }
  return press;
}

/** Sequences Ink names `f1` and then drops, so `useInput` never reports the key. */
const F1_SEQUENCES = new Set(["\u001bOP", "\u001b[P", "\u001b[11~", "\u001b[[A"]);

export function isF1(sequence: string): boolean {
  return F1_SEQUENCES.has(sequence);
}

/** Offset 0 is the first line. Page Up moves toward it. */
export function moveOverlayOffset(
  offset: number,
  toward: ScrollToward,
  lineCount: number,
  window: number,
): number {
  const visible = Math.max(1, window);
  const max = Math.max(0, lineCount - visible);
  const page = Math.max(1, visible - 1);
  if (toward === "start") {
    return 0;
  }
  if (toward === "end") {
    return max;
  }
  if (toward === "down") {
    return Math.min(max, offset + page);
  }
  return Math.max(0, offset - page);
}

function whenMatches(when: KeyWhen, place: KeyPlace, press: Press): boolean {
  if (when.name !== undefined && when.name !== press.name) {
    return false;
  }
  if (when.input !== undefined && when.input !== press.input) {
    return false;
  }
  if (when.overlay !== undefined && when.overlay !== place.overlay) {
    return false;
  }
  if (when.help !== undefined && when.help !== place.help) {
    return false;
  }
  if (when.switcher !== undefined && when.switcher !== place.switcher) {
    return false;
  }
  if (when.debug !== undefined && when.debug !== place.debug) {
    return false;
  }
  if (when.draftEmpty !== undefined && when.draftEmpty !== place.draftEmpty) {
    return false;
  }
  if (when.busy !== undefined && when.busy !== place.busy) {
    return false;
  }
  if (when.connected !== undefined && when.connected !== place.connected) {
    return false;
  }
  if (when.suggestions !== undefined && when.suggestions !== place.suggestions) {
    return false;
  }
  return true;
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
