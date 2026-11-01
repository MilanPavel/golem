import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.dirname(fileURLToPath(import.meta.url));
const SPECIFIER = /(?:from\s+|import\s*\(\s*)"([^"]+)"/g;
const BANNED = /^(?:node:|ink(?:\/|$)|react(?:-dom)?(?:\/|$)|@golem\/tui(?:\/|$))/;

function reach(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    const specifiers = [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map((m) => m[1] ?? "");
    seen.set(file, specifiers);
    for (const spec of specifiers) {
      if (spec.startsWith(".") && spec.endsWith(".ts")) queue.push(path.resolve(path.dirname(file), spec));
    }
  }
  return seen;
}

test("nothing reachable from index.ts uses Node, Ink, React or the TUI", () => {
  const graph = reach(path.join(src, "index.ts"));
  assert.ok(graph.size >= 3);
  for (const [file, specifiers] of graph) {
    const name = path.basename(file);
    assert.deepEqual(
      specifiers.filter((s) => BANNED.test(s) || s.includes("/tui/")),
      [],
      `${name} imports something the browser cannot run`,
    );
  }
});
