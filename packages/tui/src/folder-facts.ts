import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { FolderFacts } from "@golem/view";

/** Whether `folder` is in a git repository, and whether it holds any file that isn't hidden. */
export function folderFacts(folder: string): FolderFacts {
  return { git: inGitRepo(folder), empty: isEmpty(folder) };
}

function inGitRepo(folder: string): boolean {
  let current = path.resolve(folder);
  for (;;) {
    if (existsSync(path.join(current, ".git"))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

function isEmpty(folder: string): boolean {
  try {
    return readdirSync(folder).every((name) => name.startsWith("."));
  } catch {
    // A folder golem can't read gets the general prompts.
    return false;
  }
}
