/**
 * The form that tries one MCP tool: its fields come from the tool's JSON Schema, and a schema the
 * form cannot draw falls back to one JSON text. Pure, so every screen turns a form into the same
 * arguments.
 */

export type TryField = {
  /** The argument's name, which is also the field's id. */
  id: string;
  kind: "text" | "number" | "integer" | "boolean" | "choice";
  required: boolean;
  /** The schema's own description, shown under the field. */
  hint: string | null;
  /** The values of an `enum`, as text. */
  choices: readonly string[];
  /** What the field starts with: the schema's `default`, as text. */
  initial: string;
};

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldOf(id: string, schema: unknown, required: boolean): TryField | null {
  if (!isRecord(schema)) {
    return null;
  }
  const hint = typeof schema["description"] === "string" ? schema["description"] : null;
  const initial = schema["default"] === undefined || isRecord(schema["default"]) || Array.isArray(schema["default"]) ? "" : String(schema["default"]);
  const choices = schema["enum"];
  if (Array.isArray(choices)) {
    return choices.every((item) => typeof item === "string")
      ? { id, kind: "choice", required, hint, choices: choices as string[], initial }
      : null;
  }
  const kind = schema["type"];
  if (kind === "string") {
    return { id, kind: "text", required, hint, choices: [], initial };
  }
  if (kind === "number" || kind === "integer" || kind === "boolean") {
    return { id, kind, required, hint, choices: [], initial };
  }
  return null;
}

/**
 * The fields of a tool's arguments, or null when the form cannot draw them (an object or an array
 * argument, a `oneOf`, or no schema): then the person types JSON.
 */
export function tryFields(schema: unknown): TryField[] | null {
  if (!isRecord(schema) || (schema["type"] !== undefined && schema["type"] !== "object")) {
    return null;
  }
  const properties = schema["properties"];
  if (properties === undefined) {
    return [];
  }
  if (!isRecord(properties)) {
    return null;
  }
  const required = Array.isArray(schema["required"]) ? schema["required"].filter((item): item is string => typeof item === "string") : [];
  const fields: TryField[] = [];
  for (const [id, each] of Object.entries(properties)) {
    const field = fieldOf(id, each, required.includes(id));
    if (field === null) {
      return null;
    }
    fields.push(field);
  }
  return fields;
}

/** What each field starts with. A boolean starts unticked. */
export function tryInitial(fields: readonly TryField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.id, field.kind === "boolean" ? (field.initial === "true" ? "true" : "") : field.initial]));
}

export type TryArguments = { arguments: Record<string, unknown> } | { errors: Record<string, string> };

/**
 * The arguments a form makes. A field left empty is left out, unless it is required. A boolean is
 * sent when it is ticked, or when it is required.
 */
export function tryArguments(fields: readonly TryField[], values: Readonly<Record<string, string>>): TryArguments {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const text = values[field.id] ?? "";
    if (field.kind === "boolean") {
      if (text === "true" || field.required) {
        out[field.id] = text === "true";
      }
      continue;
    }
    if (text.trim() === "" && (field.kind !== "text" || text === "")) {
      if (field.required) {
        errors[field.id] = "Required.";
      }
      continue;
    }
    if (field.kind === "number" || field.kind === "integer") {
      const number = Number(text);
      if (!Number.isFinite(number) || (field.kind === "integer" && !Number.isInteger(number))) {
        errors[field.id] = field.kind === "integer" ? "A whole number." : "A number.";
        continue;
      }
      out[field.id] = number;
      continue;
    }
    out[field.id] = text;
  }
  return Object.keys(errors).length > 0 ? { errors } : { arguments: out };
}

/** `text` as the arguments of a call: nothing is `{}`, and anything but a JSON object is an error. */
export function parseJsonArguments(text: string): { arguments: Record<string, unknown> } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { arguments: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: 'Arguments are JSON, such as {"path": "/tmp"}.' };
  }
  if (!isRecord(parsed)) {
    return { error: 'Arguments must be a JSON object, such as {"path": "/tmp"}.' };
  }
  return { arguments: parsed };
}
