/**
 * Whether a command's `args` text names something it cannot run without. Arguments in `[...]` are
 * optional, so what is left outside them, such as `<provider>` or `run|pin|unpin <name>`, is required.
 */
export function needsArgs(args: string): boolean {
  let depth = 0;
  let outside = "";
  for (const char of args) {
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(depth - 1, 0);
    else if (depth === 0) outside += char;
  }
  return outside.trim() !== "";
}
