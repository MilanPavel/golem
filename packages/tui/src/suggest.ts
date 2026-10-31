export type SuggestCommand = {
  name: string;
  /** A skill's argument hint, shown after its name. */
  hint?: string;
  description: string;
  choices?: readonly string[];
  /** Choices for the word after one of `choices`. */
  subChoices?: Readonly<Record<string, readonly string[]>>;
};

export type Suggestion = {
  label: string;
  description: string;
  /** The draft after Tab, or after Enter when `partial` is true. */
  completion: string;
  /** The typed token is not this match yet, so Enter fills it in. */
  partial: boolean;
};

/**
 * Commands for a draft that starts with one `/`, then that command's choices
 * after a space, then the choices for the word after that, such as the skill
 * names after `/skill run`. Prefix matches come before substring matches.
 * `//` is a message, so it never suggests.
 */
export function suggest(draft: string, registry: readonly SuggestCommand[]): Suggestion[] {
  if (!draft.startsWith("/") || draft.startsWith("//")) {
    return [];
  }
  const space = draft.search(/\s/);
  if (space === -1) {
    return rank(registry, (command) => command.name, draft).map((command) => ({
      label: command.hint === undefined || command.hint.length === 0 ? command.name : `${command.name} ${command.hint}`,
      description: command.description,
      completion: `${command.name} `,
      partial: draft !== command.name,
    }));
  }
  const name = draft.slice(0, space);
  const rest = draft.slice(space).trimStart();
  const command = registry.find((candidate) => candidate.name === name);
  if (/\s/.test(rest)) {
    return subSuggestions(command, name, rest);
  }
  const choices = command?.choices;
  if (command === undefined || choices === undefined || choices.length === 0) {
    return [];
  }
  return rank(choices, (choice) => choice, rest).map((choice) => ({
    label: choice,
    description: command.description,
    completion: `${name} ${choice}`,
    partial: rest.length > 0 && rest !== choice,
  }));
}

function subSuggestions(command: SuggestCommand | undefined, name: string, rest: string): Suggestion[] {
  const space = rest.search(/\s/);
  const choice = rest.slice(0, space);
  const word = rest.slice(space).trimStart();
  const choices = command?.subChoices?.[choice];
  if (command === undefined || choices === undefined || choices.length === 0 || /\s/.test(word)) {
    return [];
  }
  return rank(choices, (item) => item, word).map((item) => ({
    label: item,
    description: command.description,
    completion: `${name} ${choice} ${item} `,
    partial: word !== item,
  }));
}

export function applySuggestion(
  draft: string,
  items: readonly Suggestion[],
  index: number,
  key: "tab" | "enter",
): { draft: string; submit: boolean } {
  const item = items[Math.max(0, Math.min(index, items.length - 1))];
  if (item === undefined) {
    return { draft, submit: key === "enter" };
  }
  if (key === "enter" && !item.partial) {
    return { draft, submit: true };
  }
  if (item.completion === draft) {
    return { draft, submit: false };
  }
  return { draft: item.completion, submit: false };
}

export function moveSuggestion(index: number, toward: "up" | "down", count: number): number {
  if (count <= 0) {
    return 0;
  }
  const current = Math.max(0, Math.min(index, count - 1));
  const next = toward === "up" ? current - 1 : current + 1;
  return Math.max(0, Math.min(count - 1, next));
}

/** Keeps the selected row on screen. The window is at most `rows` tall. */
export function suggestionWindow(
  count: number,
  selected: number,
  rows: number,
): { start: number; index: number } {
  if (count <= 0 || rows <= 0) {
    return { start: 0, index: 0 };
  }
  const index = Math.max(0, Math.min(selected, count - 1));
  const height = Math.min(rows, count);
  const start = Math.min(count - height, Math.max(0, index - height + 1));
  return { start, index };
}

function rank<T>(items: readonly T[], text: (item: T) => string, query: string): T[] {
  const needle = query.startsWith("/") ? query.slice(1) : query;
  const prefix: T[] = [];
  const substr: T[] = [];
  for (const item of items) {
    const hay = text(item);
    const value = hay.startsWith("/") ? hay.slice(1) : hay;
    if (needle.length === 0 || value.startsWith(needle)) {
      prefix.push(item);
    } else if (value.includes(needle)) {
      substr.push(item);
    }
  }
  return [...prefix, ...substr];
}
