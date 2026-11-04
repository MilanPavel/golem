/**
 * Starter prompts under an empty chat (step 1.11.1): two or three things to
 * ask, picked from the folder the session is in. Pure, so the web UI can show
 * the same ones.
 */

/** What the client found about the session's folder. */
export type FolderFacts = {
  /** The folder is in a git repository. */
  git: boolean;
  /** The folder has no files, hidden ones aside. */
  empty: boolean;
};

/** The prompts for a folder, best first. */
export function starterPrompts(facts: FolderFacts): readonly string[] {
  if (facts.git) {
    return ["Explain this project", "Find TODOs and group them", "What changed in the last few commits?"];
  }
  if (facts.empty) {
    return ["What can you do?", "Help me start a new project here"];
  }
  return ["Summarize what is in this folder", "What can you do?"];
}

/** Which prompt is picked. Null until Down moves into the list. */
export type StarterPick = number | null;

/** The prompts show only in a chat with no messages, while the composer is empty. */
export function startersShown(input: { messages: number; draft: string; busy: boolean }): boolean {
  return input.messages === 0 && input.draft.length === 0 && !input.busy;
}

export type StarterKey = "up" | "down" | "enter" | "escape";

export type StarterPress =
  | { kind: "pick"; pick: StarterPick }
  /** Put this prompt in the composer. */
  | { kind: "fill"; text: string }
  /** Not for the list: Up recalls history and Enter does what it always does. */
  | { kind: "pass" };

/**
 * A key while the prompts show. With none picked, only Down is theirs, so Up
 * still recalls history. With one picked, Up and Down move, Up from the first
 * leaves the list, Enter fills the composer, and Esc leaves the list.
 */
export function pressStarter(pick: StarterPick, key: StarterKey, prompts: readonly string[]): StarterPress {
  if (prompts.length === 0) {
    return { kind: "pass" };
  }
  if (pick === null) {
    return key === "down" ? { kind: "pick", pick: 0 } : { kind: "pass" };
  }
  switch (key) {
    case "down":
      return { kind: "pick", pick: Math.min(pick + 1, prompts.length - 1) };
    case "up":
      return { kind: "pick", pick: pick === 0 ? null : pick - 1 };
    case "escape":
      return { kind: "pick", pick: null };
    case "enter": {
      const text = prompts[pick];
      return text === undefined ? { kind: "pick", pick: null } : { kind: "fill", text };
    }
  }
}

export type StarterLine = { text: string; selected: boolean; dim: boolean };

/** The list as it shows: one row per prompt, then how to pick one. */
export function starterLines(prompts: readonly string[], pick: StarterPick): StarterLine[] {
  if (prompts.length === 0) {
    return [];
  }
  const rows = prompts.map((text, index): StarterLine => {
    const selected = index === pick;
    return { text: `${selected ? "›" : " "} ${text}`, selected, dim: !selected };
  });
  const how = pick === null ? "↓ to pick one" : "Enter puts it in the composer · Esc";
  return [...rows, { text: `  ${how}`, selected: false, dim: true }];
}
