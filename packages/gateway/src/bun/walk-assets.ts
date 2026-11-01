import fs from "node:fs";
import path from "node:path";

/** The regular files under `dir`, as URL keys and absolute paths, sorted by key. Skips dotfiles and symlinks. */
export function walkAssets(dir: string): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = [];
  const visit = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file, `${prefix}${entry.name}/`);
      else if (entry.isFile()) found.push({ key: `${prefix}${entry.name}`, file });
    }
  };
  visit(path.resolve(dir), "/");
  return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
