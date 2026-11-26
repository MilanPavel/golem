/**
 * The inputs of a workflow as a form (3.9.4): the control each gets from its declared type, what it starts with, what is
 * wrong with it, and the `inputs` of `workflow.start`. Pure, shared by the page's Run dialog and the terminal's form.
 */

/** One declared input, as `workflow.list` sends it. */
export type WorkflowInputInfo = { name: string; type?: string | null; default?: string | null };

/** The control an input gets, picked from its declared type name. */
export type InputKind = "text" | "number" | "bool" | "choice" | "folder";

export type InputField = {
  name: string;
  kind: InputKind;
  /** The type as declared, shown under the field. Empty when the file declares none. */
  typeName: string;
  /** The default as a person would type it: the quotes of a string literal are gone. Null when there is none. */
  default: string | null;
  required: boolean;
  choices: readonly string[];
};

const NUMBER_TYPES = new Set(["int", "float", "number", "decimal"]);
const FOLDER_TYPES = new Set(["folder", "dir", "directory", "path"]);

/** `Literal["a", "b"]` gives its members. Anything else gives none. */
function literalChoices(type: string): string[] {
  const body = /^Literal\[(.*)\]$/s.exec(type.trim())?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2] ?? "");
}

/** A default is written as Python source: `"1d"` is the text 1d. */
function readDefault(raw: string): string {
  const quoted = /^(["'])(.*)\1$/s.exec(raw.trim());
  return quoted ? (quoted[2] ?? "") : raw.trim();
}

export function inputFields(inputs: readonly WorkflowInputInfo[] | undefined): InputField[] {
  return (inputs ?? []).map((input) => {
    const type = (input.type ?? "").trim();
    const lower = type.toLowerCase();
    const choices = literalChoices(type);
    const kind: InputKind = choices.length > 0 ? "choice" : lower === "bool" ? "bool" : NUMBER_TYPES.has(lower) ? "number" : FOLDER_TYPES.has(lower) ? "folder" : "text";
    const given = input.default === undefined || input.default === null ? null : readDefault(input.default);
    return { name: input.name, kind, typeName: type, default: given, required: given === null, choices };
  });
}

/** What each field shows when the dialog opens: its default, or nothing. */
export function initialValues(fields: readonly InputField[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field.name, field.kind === "bool" ? String((field.default ?? "").toLowerCase() === "true") : (field.default ?? "")]),
  );
}

/** The complaint for a field, or null. A field with a default may be left empty. */
export function fieldProblem(field: InputField, value: string): string | null {
  if (field.kind === "bool") return null;
  if (value.trim() === "") return field.required ? "Required." : null;
  if (field.kind === "number" && Number.isNaN(Number(value))) return "Enter a number.";
  return null;
}

/** What a routine's `inputs` table gives each field, as the text a person would type. A field the table does not name is left out. */
export function valuesFromInputs(fields: readonly InputField[], inputs: Readonly<Record<string, string | number | boolean>> | null | undefined): Record<string, string> {
  const given: Record<string, string> = {};
  for (const field of fields) {
    const value = inputs?.[field.name];
    if (value !== undefined) given[field.name] = String(value);
  }
  return given;
}

/** The `inputs` of `workflow.start`. An empty field with a default is left out, so the workflow's own default applies. */
export function startInputs(fields: readonly InputField[], values: Readonly<Record<string, string>>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name] ?? "";
    if (field.kind === "bool") inputs[field.name] = value === "true";
    else if (value.trim() !== "") inputs[field.name] = field.kind === "number" ? Number(value) : value;
  }
  return inputs;
}
