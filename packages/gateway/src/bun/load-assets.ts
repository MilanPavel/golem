import fs from "node:fs";
import path from "node:path";

import { EMBEDDED } from "./assets.gen.ts";
import { walkAssets } from "./walk-assets.ts";

const PLACEHOLDER_DIR = path.resolve(import.meta.dir, "..", "..", "placeholder");
const BUILT_DIR = path.resolve(import.meta.dir, "..", "..", "..", "web", "dist");

/** URL keys to the absolute path of each regular file under `dir`. */
export function folderAssets(dir: string): ReadonlyMap<string, string> {
  return new Map(walkAssets(dir).map((f) => [f.key, f.file]));
}

/** The built page when `builtDir` holds an index.html, else the placeholder folder. */
export function checkoutAssets(builtDir: string, placeholderDir: string): ReadonlyMap<string, string> {
  const built = fs.existsSync(path.join(builtDir, "index.html"));
  return folderAssets(built ? builtDir : placeholderDir);
}

/** The page's files: the ones embedded in the binary, or a folder in a checkout. */
export function loadAssets(): ReadonlyMap<string, string> {
  return EMBEDDED ?? checkoutAssets(BUILT_DIR, PLACEHOLDER_DIR);
}
