/**
 * The words of the New workflow page, and the file name a typed name stands for. Pure, so the web
 * and the terminal say the same thing. `workflowFileName` follows the daemon's `file_name`
 * (`golem/workflows/create.py`): the same cases give the same answers.
 */

/** The longest name the daemon takes. */
export const MAX_WORKFLOW_NAME = 60;

const RESERVED = new Set(["run", "workflow", "golem"]);
const PYTHON_KEYWORDS = new Set(["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);

/** What a typed name stands for: the file and function name, and the title in words. */
export type WorkflowFileName = { file: string; title: string };

/** The file name and title of a typed name ("Weekly invoices" is `weekly_invoices`), or the reason it cannot be one. */
export function workflowFileName(typed: string): WorkflowFileName | { problem: string } {
  const words = typed.trim();
  if (words === "") return { problem: "Give the workflow a name." };
  if (words.length > MAX_WORKFLOW_NAME) return { problem: `The name is too long (at most ${MAX_WORKFLOW_NAME} characters).` };
  const file = words
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (file === "") return { problem: "The name needs letters or numbers from a to z." };
  if (/^[0-9]/.test(file)) return { problem: "The name must start with a letter." };
  if (PYTHON_KEYWORDS.has(file) || RESERVED.has(file)) return { problem: `${file} is a word Python keeps for itself. Pick another name.` };
  const shown = words.includes(" ") || words !== words.toLowerCase() ? words : file.replace(/_/g, " ");
  return { file, title: shown.charAt(0).toUpperCase() + shown.slice(1) };
}

/** `name` with the first number after it that is not in `taken`: `name_2`, `name_3`. */
export function suggestFreeName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let number = 2;
  while (used.has(`${name}_${number}`)) number += 1;
  return `${name}_${number}`;
}

/** What the page says about a name that is in use, with the free name it suggests. */
export function nameTakenWords(file: string, free: string): string {
  return `A workflow called ${file} is there already. Try ${free}.`;
}

export const NEW_WORKFLOW_TITLE = "New workflow";
export const NEW_WORKFLOW_BUTTON = "+ New workflow";
export const NEW_WORKFLOW_INTRO = "A workflow is a list of steps golem runs the same way every time. Say what you want, or start from something.";
export const DESCRIBE_TITLE = "Describe it";
export const DESCRIBE_HELP = "A few sentences about what it should do. golem writes the steps and shows them first: nothing runs and nothing is saved until you press Save.";
export const DESCRIBE_TRIES: readonly string[] = ["summarise new PDFs in a folder", "check my sites are up and tell me if not", "a weekly digest of open pull requests"];
export const WRITE_STEPS_WORDS = "Write the steps";
export const EMPTY_FILE_TITLE = "Empty file";
export const EMPTY_FILE_HELP = "For writing the Python yourself. Opens the code with a two-step skeleton.";
export const CREATE_WORDS = "Create";
export const STARTERS_TITLE = "Start from a starter";
export const STARTERS_HELP = "A finished workflow you change to fit. It keeps its own file name.";
export const FROM_CHAT_TITLE = "From a chat";
export const FROM_CHAT_HELP = "Did it once by hand in a chat? golem turning what you did there into steps is coming. It is not here yet.";
export const SCHEDULE_ASK_TITLE = "Run it on a schedule?";
export const SCHEDULE_ASK_HELP = "The workflow is saved. Without a routine it runs only when you press Run.";
export const SCHEDULE_YES_WORDS = "Yes, add a routine";
export const SCHEDULE_NO_WORDS = "Not now";
export const NEXT_STEPS: readonly string[] = [
  "golem writes the steps and shows them in words, with the code beside. Nothing has run.",
  "Change a step in its fields, or tell golem what to change.",
  "Save. golem then asks: run it on a schedule? Yes opens a new routine, filled in.",
];

/** Where the file goes, in words: yours, or the project's folder. */
export function saveInWords(project: string | null): string {
  return project === null ? "Yours (~/.golem/workflows)" : `This project (${project}/workflows)`;
}

/** The model line of Describe: whose model writes it, and that it becomes the workflow's model only when picked. */
export function describeModelWords(picked: string | null, defaultModel: string | null): string {
  if (picked !== null) return `${picked} writes it and is written in the file as the workflow's model.`;
  return defaultModel === null ? "golem's default model writes it. No model is set up yet: set one up in Settings › Models." : `golem's default model, ${defaultModel}, writes it. No model is written in the file.`;
}
