import { type EditOp } from "./edit.ts";
import { type SwitcherKey } from "./switcher.ts";

/** Where a binding applies. The overlay groups rows by these names. */
export type KeyContext = "composer" | "transcript" | "switcher" | "debug" | "approval";

export const KEY_CONTEXTS: readonly KeyContext[] = ["composer", "transcript", "switcher", "debug", "approval"];

export type PressName =
  | "ctrl-c"
  | "ctrl-d"
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
  | "delete"
  | "up"
  | "down"
  | "left"
  | "right"
  | "alt-left"
  | "alt-right"
  | "alt-return"
  | "alt-backspace"
  | "ctrl-a"
  | "ctrl-e"
  | "ctrl-w"
  | "ctrl-u"
  | "ctrl-k"
  | "ctrl-g"
  | "ctrl-o";

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
  leftArrow: boolean;
  rightArrow: boolean;
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
  /** Ctrl-D has asked before closing the selected session. */
  switcherConfirm: boolean;
  /** The switcher filter has at least one letter. */
  switcherFiltering: boolean;
  debug: boolean;
  draftEmpty: boolean;
  busy: boolean;
  connected: boolean;
  suggestions: boolean;
  /** Up has already recalled a message, so Down and Esc stay on that list. */
  history: boolean;
  /** The run waits for an answer about a tool call. */
  approval?: boolean;
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
  | { kind: "switcher"; key: SwitcherKey }
  | { kind: "suggest"; key: "up" | "down" | "tab" | "enter" | "close" }
  | { kind: "history"; key: "older" | "newer" | "close" }
  | { kind: "submit" }
  | { kind: "edit"; op: EditOp }
  | { kind: "edit-external" }
  | { kind: "toggle-tools" }
  | { kind: "approve"; decision: "allow" | "allow_session" | "allow_always" | "deny" }
  | { kind: "insert"; text: string }
  | { kind: "ignore" };

type KeyWhen = {
  name?: PressName;
  input?: string;
  overlay?: boolean;
  help?: boolean;
  switcher?: boolean;
  switcherConfirm?: boolean;
  switcherFiltering?: boolean;
  debug?: boolean;
  draftEmpty?: boolean;
  busy?: boolean;
  connected?: boolean;
  suggestions?: boolean;
  history?: boolean;
  approval?: boolean;
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
  ...approvalKeys(),
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
    id: "history-up",
    label: "Up",
    contexts: ["composer"],
    description: "On an empty line, recalls an earlier message, newest first.",
    when: { name: "up", overlay: false, switcher: false, suggestions: false, busy: false },
    run: (place) =>
      place.history || place.draftEmpty ? { kind: "history", key: "older" } : { kind: "ignore" },
  },
  {
    id: "history-down",
    label: "Down",
    contexts: ["composer"],
    description: "Steps back toward the line you had before recalling.",
    when: { name: "down", overlay: false, switcher: false, suggestions: false, busy: false, history: true },
    run: () => ({ kind: "history", key: "newer" }),
  },
  {
    id: "history-close",
    label: "Esc",
    contexts: ["composer"],
    description: "Restores the draft from before you recalled a message.",
    when: { name: "escape", overlay: false, history: true },
    run: () => ({ kind: "history", key: "close" }),
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
    description: "Jumps back to the newest line, or the end of this list.",
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
    id: "switcher-confirm",
    label: "y",
    contexts: ["switcher"],
    description: "Closes the selected session.",
    when: { input: "y", overlay: false, switcher: true, switcherConfirm: true },
    run: () => ({ kind: "switcher", key: "confirm" }),
  },
  {
    id: "switcher-disarm",
    label: "Esc",
    contexts: ["switcher"],
    description: "Cancels closing a session.",
    when: { name: "escape", overlay: false, switcher: true, switcherConfirm: true },
    run: () => ({ kind: "switcher", key: "disarm" }),
  },
  {
    id: "switcher-arm",
    label: "Ctrl-D",
    contexts: ["switcher"],
    description: "Asks before closing the selected session.",
    when: { name: "ctrl-d", overlay: false, switcher: true, switcherConfirm: false },
    run: () => ({ kind: "switcher", key: "arm" }),
  },
  {
    id: "switcher-backspace",
    label: "Backspace",
    contexts: ["switcher"],
    description: "Deletes the last letter of the filter.",
    when: { name: "backspace", overlay: false, switcher: true, switcherConfirm: false },
    run: () => ({ kind: "switcher", key: "backspace" }),
  },
  {
    id: "switcher-clear",
    label: "Esc",
    contexts: ["switcher"],
    description: "Clears the filter.",
    when: {
      name: "escape",
      overlay: false,
      switcher: true,
      switcherConfirm: false,
      switcherFiltering: true,
    },
    run: () => ({ kind: "switcher", key: "clear-query" }),
  },
  {
    id: "switcher-up",
    label: "Up",
    contexts: ["switcher"],
    description: "Moves the selection up.",
    when: { name: "up", overlay: false, switcher: true, switcherConfirm: false },
    run: () => ({ kind: "switcher", key: "up" }),
  },
  {
    id: "switcher-down",
    label: "Down",
    contexts: ["switcher"],
    description: "Moves the selection down.",
    when: { name: "down", overlay: false, switcher: true, switcherConfirm: false },
    run: () => ({ kind: "switcher", key: "down" }),
  },
  {
    id: "switcher-enter",
    label: "Enter",
    contexts: ["switcher"],
    description: "Opens the selected session.",
    when: { name: "return", overlay: false, switcher: true, switcherConfirm: false },
    run: () => ({ kind: "switcher", key: "enter" }),
  },
  {
    id: "switcher-new",
    label: "n",
    contexts: ["switcher"],
    description: "Starts a new session.",
    when: { input: "n", overlay: false, switcher: true, switcherConfirm: false, switcherFiltering: false },
    run: () => ({ kind: "switcher", key: "new" }),
  },
  {
    id: "switcher-close",
    label: "Esc",
    contexts: ["switcher"],
    description: "Closes the switcher.",
    when: {
      name: "escape",
      overlay: false,
      help: false,
      switcher: true,
      switcherConfirm: false,
      switcherFiltering: false,
    },
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
    id: "tool-output",
    label: "Ctrl-O",
    contexts: ["transcript"],
    description: "Shows or hides the output of tool calls.",
    when: { name: "ctrl-o", overlay: false, switcher: false },
    run: () => ({ kind: "toggle-tools" }),
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
  ...editKeys(),
];

function approvalKeys(): KeyBinding[] {
  const answer = (
    id: string,
    label: string,
    description: string,
    press: { name?: PressName; input?: string },
    decision: "allow" | "allow_session" | "allow_always" | "deny",
  ): KeyBinding => ({
    id,
    label,
    contexts: ["approval"],
    description,
    when: { ...press, overlay: false, switcher: false, approval: true },
    run: () => ({ kind: "approve", decision }),
  });
  return [
    answer("approve-once", "a", "Allows the waiting tool call once. Enter does the same.", { input: "a" }, "allow"),
    answer("approve-enter", "Enter", "Allows the waiting tool call once.", { name: "return" }, "allow"),
    answer(
      "approve-session",
      "s",
      "Allows the call, and this tool for the rest of the session.",
      { input: "s" },
      "allow_session",
    ),
    answer(
      "approve-always",
      "w",
      "Allows the call, and writes a rule to ~/.golem/config.toml so it never asks again.",
      { input: "w" },
      "allow_always",
    ),
    answer("deny", "d", "Denies the waiting tool call. Esc does the same.", { input: "d" }, "deny"),
    answer("deny-esc", "Esc", "Denies the waiting tool call.", { name: "escape" }, "deny"),
  ];
}

function editKey(
  id: string,
  label: string,
  description: string,
  name: PressName,
  op: EditOp | "external",
): KeyBinding {
  return {
    id,
    label,
    contexts: ["composer"],
    description,
    when: { name, overlay: false, switcher: false, busy: false, connected: true },
    run: () => (op === "external" ? { kind: "edit-external" } : { kind: "edit", op }),
  };
}

function editKeys(): KeyBinding[] {
  return [
    editKey("left", "Left", "Moves the cursor left.", "left", "left"),
    editKey("right", "Right", "Moves the cursor right.", "right", "right"),
    editKey("word-left", "Alt-Left", "Moves the cursor to the previous word.", "alt-left", "word-left"),
    editKey("word-right", "Alt-Right", "Moves the cursor to the next word.", "alt-right", "word-right"),
    editKey("line-start", "Ctrl-A", "Moves the cursor to the start of the line.", "ctrl-a", "line-start"),
    editKey("line-end", "Ctrl-E", "Moves the cursor to the end of the line.", "ctrl-e", "line-end"),
    editKey("backspace", "Backspace", "Deletes the character before the cursor.", "backspace", "backspace"),
    editKey("delete", "Delete", "Deletes the character after the cursor.", "delete", "delete"),
    editKey("delete-word", "Ctrl-W", "Deletes the word before the cursor.", "ctrl-w", "delete-word"),
    editKey(
      "alt-backspace",
      "Alt-Backspace",
      "Deletes the word before the cursor.",
      "alt-backspace",
      "delete-word",
    ),
    editKey("delete-to-start", "Ctrl-U", "Deletes back to the start of the line.", "ctrl-u", "delete-to-start"),
    editKey("delete-to-end", "Ctrl-K", "Deletes forward to the end of the line.", "ctrl-k", "delete-to-end"),
    editKey("newline", "Shift-Enter", "Inserts a new line. Alt-Enter does the same.", "alt-return", "newline"),
    editKey("editor", "Ctrl-G", "Opens the draft in your editor.", "ctrl-g", "external"),
  ];
}

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
    place.switcher &&
    !place.switcherConfirm &&
    !place.overlay &&
    press.input.length === 1 &&
    !press.ctrl &&
    !press.meta &&
    press.name === null
  ) {
    return { kind: "switcher", key: { kind: "type", text: press.input } };
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
  if (key.ctrl && input === "d") {
    return { ...press, name: "ctrl-d" };
  }
  if (key.ctrl && !key.meta) {
    const named = ctrlName(input);
    if (named !== null) {
      return { ...press, name: named };
    }
  }
  if (key.leftArrow) {
    return { ...press, name: key.meta ? "alt-left" : "left" };
  }
  if (key.rightArrow) {
    return { ...press, name: key.meta ? "alt-right" : "right" };
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
    return { ...press, name: key.meta || key.shift ? "alt-return" : "return" };
  }
  if (key.backspace) {
    return { ...press, name: key.meta ? "alt-backspace" : "backspace" };
  }
  if (key.delete) {
    return { ...press, name: "delete" };
  }
  if (input === "?") {
    return { ...press, name: "question" };
  }
  return press;
}

function ctrlName(input: string): PressName | null {
  if (input === "a") {
    return "ctrl-a";
  }
  if (input === "e") {
    return "ctrl-e";
  }
  if (input === "w") {
    return "ctrl-w";
  }
  if (input === "u") {
    return "ctrl-u";
  }
  if (input === "k") {
    return "ctrl-k";
  }
  if (input === "g") {
    return "ctrl-g";
  }
  if (input === "o") {
    return "ctrl-o";
  }
  return null;
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
  if (when.switcherConfirm !== undefined && when.switcherConfirm !== place.switcherConfirm) {
    return false;
  }
  if (when.switcherFiltering !== undefined && when.switcherFiltering !== place.switcherFiltering) {
    return false;
  }
  if (when.debug !== undefined && when.debug !== place.debug) {
    return false;
  }
  if (when.approval !== undefined && when.approval !== (place.approval === true)) {
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
  if (when.history !== undefined && when.history !== place.history) {
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
