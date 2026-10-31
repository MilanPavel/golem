// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// A utility followed by -[...], or an arbitrary property such as [color:red].
// A data-[...] or aria-[...] variant matches an attribute, not a value, so it is allowed.
const ARBITRARY_VALUE = /(?<![\w-])(?!data-|aria-)[a-z][a-z0-9-]*-\[[^\]\s]+\]/;
const ARBITRARY_PROPERTY = /(?<![\w\]])\[[a-z-]+:[^\]\s]+\]/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;

function findings(text: string, checkHex: boolean): number[] {
  const lines: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (ARBITRARY_VALUE.test(line) || ARBITRARY_PROPERTY.test(line) || (checkHex && RAW_HEX.test(line))) {
      lines.push(i + 1);
    }
  });
  return lines;
}

const src = fileURLToPath(new URL("..", import.meta.url));

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

test("no component uses an arbitrary Tailwind value or a raw hex colour", () => {
  const found: string[] = [];
  for (const path of files(src)) {
    const isTokens = path.endsWith(join("styles", "tokens.css"));
    if (isTokens) continue;
    for (const line of findings(readFileSync(path, "utf8"), true)) {
      found.push(`${path.slice(src.length)}:${line}`);
    }
  }
  expect(found, `Arbitrary values or raw colours (make them tokens):\n${found.join("\n")}`).toEqual([]);
});

test("the check catches arbitrary values and passes tokens", () => {
  expect(findings('<div className="bg-[#123456]" />', false)).toEqual([1]);
  expect(findings('<div className="p-[13px]" />', false)).toEqual([1]);
  expect(findings('<div className="[color:red]" />', false)).toEqual([1]);
  expect(findings('<div className="bg-surface p-4" />', false)).toEqual([]);
  expect(findings('<div className="data-[state=open]:animate-pop-in aria-[sort=asc]:bg-line" />', false)).toEqual([]);
  expect(findings('<div className="data-[state=open]:p-[13px]" />', false)).toEqual([1]);
  expect(findings('const color = "#123456";', true)).toEqual([1]);
});
