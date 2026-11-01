import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkoutAssets } from "./load-assets.ts";

function withDirs(built: boolean, run: (builtDir: string, placeholderDir: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-"));
  const builtDir = path.join(root, "dist");
  const placeholderDir = path.join(root, "placeholder");
  try {
    fs.mkdirSync(placeholderDir);
    fs.writeFileSync(path.join(placeholderDir, "index.html"), "placeholder");
    if (built) {
      fs.mkdirSync(path.join(builtDir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(builtDir, "index.html"), "built");
      fs.writeFileSync(path.join(builtDir, "assets", "a.js"), "x");
    }
    run(builtDir, placeholderDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a built page wins over the placeholder", () => {
  withDirs(true, (b, p) => {
    expect([...checkoutAssets(b, p).keys()].sort()).toEqual(["/assets/a.js", "/index.html"]);
  });
});

test("a missing built folder falls back to the placeholder", () => {
  withDirs(false, (b, p) => {
    const files = checkoutAssets(b, p);
    expect([...files.keys()]).toEqual(["/index.html"]);
    expect(files.get("/index.html")).toBe(path.join(p, "index.html"));
  });
});

test("a built folder without index.html falls back to the placeholder", () => {
  withDirs(false, (b, p) => {
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, "stray.js"), "x");
    expect([...checkoutAssets(b, p).keys()]).toEqual(["/index.html"]);
  });
});
