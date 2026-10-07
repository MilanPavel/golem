import { readFileSync } from "node:fs";
import path from "node:path";

const WORKSPACE_NAME = 'name = "golem-workspace"';

/** Walk parents until the uv workspace root that owns this repository. */
export function findWorkspaceRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    try {
      const text = readFileSync(path.join(dir, "pyproject.toml"), "utf8");
      if (text.includes(WORKSPACE_NAME)) {
        return dir;
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("golem workspace root not found");
    }
    dir = parent;
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
