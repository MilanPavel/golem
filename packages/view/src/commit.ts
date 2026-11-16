/** The words and small rules of the commit screen. Shared by the web dialog and the terminal band. */

/** Shown in the message box while the model writes a suggestion. */
export const SUGGESTING = "Suggesting…";

/** The person commits: golem only fills in a message. */
export const COMMIT_NOTE = "You are committing these files yourself, with your own git and your hooks. Nothing is pushed.";

/** How many lines of git's output a small screen shows after a failed commit. */
export const FAILURE_LINES = 6;

function filesWord(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** `commit 3 files on main`. A detached head has no branch to name. */
export function commitTitle(count: number, branch: string | null): string {
  return `commit ${filesWord(count)}${branch === null ? "" : ` on ${branch}`}`;
}

/** `on main`, or a note for a detached head. */
export function branchLine(branch: string | null): string {
  return branch === null ? "Not on a branch" : `on ${branch}`;
}

/** The notice after a commit. */
export function committedLine(sha: string | null): string {
  return sha === null ? "Committed" : `Committed ${sha}`;
}

/** The last `max` non-empty lines of git's output. */
export function failureTail(output: string, max = FAILURE_LINES): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  return lines.slice(-max);
}

/** A suggestion fills an empty box only. What the person typed wins. */
export function withSuggestion(current: string, suggestion: string): string {
  return current.trim() === "" ? suggestion : current;
}
