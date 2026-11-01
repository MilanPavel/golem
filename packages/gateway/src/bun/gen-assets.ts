import fs from "node:fs";
import path from "node:path";

import { walkAssets } from "./walk-assets.ts";

const STUB = `// Written by gen-assets.ts during \`just dist\`. The committed stub has no files: a checkout serves the folder.
export const EMBEDDED: ReadonlyMap<string, string> | null = null;
`;

/** The source of assets.gen.ts that embeds each file. `importPath` is relative to that module. */
export function renderAssetModule(files: { key: string; importPath: string }[]): string {
  const imports = files.map((f, i) => `import f${i} from ${JSON.stringify(f.importPath)} with { type: "file" };`);
  const entries = files.map((f, i) => `[${JSON.stringify(f.key)}, f${i}]`);
  return [
    "// Written by gen-assets.ts during `just dist`. Do not commit this version.",
    ...imports,
    `export const EMBEDDED: ReadonlyMap<string, string> | null = new Map([${entries.join(", ")}]);`,
    "",
  ].join("\n");
}

export { STUB };

function main(argv: string[]): number {
  const target = path.join(import.meta.dir, "assets.gen.ts");
  if (argv[0] === "--stub") {
    fs.writeFileSync(target, STUB);
    return 0;
  }
  const source = argv[0];
  if (source === undefined) {
    process.stderr.write("usage: gen-assets.ts <source-dir> | --stub\n");
    return 1;
  }
  if (!fs.existsSync(path.join(source, "index.html"))) {
    process.stderr.write(`gen-assets: ${path.resolve(source)} has no index.html\n`);
    return 1;
  }
  const files = walkAssets(source).map((f) => {
    let importPath = path.relative(import.meta.dir, f.file).split(path.sep).join("/");
    if (!importPath.startsWith(".")) importPath = `./${importPath}`;
    return { key: f.key, importPath };
  });
  fs.writeFileSync(target, renderAssetModule(files));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
