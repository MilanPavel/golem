import os from "node:os";
import path from "node:path";

/** Same precedence as ``golem.paths.resolve_paths``: argument, then ``GOLEM_HOME``, then ``~/.golem``. */
export function resolveSocketPath(home?: string): string {
  const fromEnv = process.env["GOLEM_HOME"]?.trim() ?? "";
  const selected = home ?? (fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), ".golem"));
  return path.join(resolveHome(selected), "run", "golem.sock");
}

function resolveHome(input: string): string {
  let expanded = input;
  if (expanded === "~") {
    expanded = os.homedir();
  } else if (expanded.startsWith("~/")) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }
  return path.resolve(expanded);
}
