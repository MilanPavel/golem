export type ParsedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

/** The text as one JSON object, or why it is not. */
export function parseArgs(text: string): ParsedArgs {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "the arguments must be one JSON object" };
  }
  return { ok: true, args: value as Record<string, unknown> };
}

/** The edited arguments, or null when they are the call's own and nothing was edited. */
export function editedArgs(
  original: Readonly<Record<string, unknown>>,
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  return JSON.stringify(args) === JSON.stringify(original) ? null : args;
}
