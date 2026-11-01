import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EMBEDDED } from "./assets.gen.ts";
import { STUB, renderAssetModule } from "./gen-assets.ts";

test("renderAssetModule imports each file and maps its key", () => {
  const out = renderAssetModule([
    { key: "/index.html", importPath: "../../placeholder/index.html" },
    { key: "/a\"b.js", importPath: "./a\"b.js" },
  ]);
  expect(out).toContain('import f0 from "../../placeholder/index.html" with { type: "file" };');
  expect(out).toContain('import f1 from "./a\\"b.js" with { type: "file" };');
  expect(out).toContain('new Map([["/index.html", f0], ["/a\\"b.js", f1]])');
});

test("the committed module is the stub", () => {
  expect(EMBEDDED).toBeNull();
  expect(fs.readFileSync(path.join(import.meta.dir, "assets.gen.ts"), "utf8")).toBe(STUB);
});

test("a source folder without index.html exits 1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-"));
  try {
    const run = Bun.spawnSync(["bun", path.join(import.meta.dir, "gen-assets.ts"), dir]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("no index.html");
    expect(fs.readFileSync(path.join(import.meta.dir, "assets.gen.ts"), "utf8")).toBe(STUB);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
