import path from "node:path";

import { EMBEDDED } from "./assets.gen.ts";
import { walkAssets } from "./walk-assets.ts";

const PLACEHOLDER_DIR = path.resolve(import.meta.dir, "..", "..", "placeholder");

/** URL keys to the absolute path of each regular file under `dir`. */
export function folderAssets(dir: string): ReadonlyMap<string, string> {
  return new Map(walkAssets(dir).map((f) => [f.key, f.file]));
}

/** The page's files: the ones embedded in the binary, or the placeholder folder in a checkout. */
export function loadAssets(): ReadonlyMap<string, string> {
  return EMBEDDED ?? folderAssets(PLACEHOLDER_DIR);
}
