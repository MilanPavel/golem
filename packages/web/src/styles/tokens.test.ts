// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

type Pair = { slip: string; kiln: string };

const tokens = new Map<string, Pair>();
for (const m of css.matchAll(/--color-([a-z-]+):\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)\s*;/g)) {
  tokens.set(m[1]!, { slip: m[2]!, kiln: m[3]! });
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const text: Record<string, string[]> = {
  ink: ["bg", "surface", "sunken", "slip", "code-bg"],
  muted: ["bg", "surface", "sunken", "slip"],
  faint: ["bg", "surface", "sunken"],
  "clay-ink": ["bg", "surface", "clay-soft"],
  allow: ["surface", "bg", "allow-soft"],
  deny: ["surface", "bg", "deny-soft"],
  wait: ["bg", "surface", "sunken", "wait-soft"],
};
const nonText: Record<string, string[]> = { clay: ["bg", "surface"] };

const cases: [string, string, number][] = [
  ...Object.entries(text).flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg, 4.5] as [string, string, number])),
  ...Object.entries(nonText).flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg, 3] as [string, string, number])),
];

test("the tokens file defines colour tokens", () => {
  expect(tokens.size).toBeGreaterThanOrEqual(21);
});

test("every colour token is a light-dark pair of two 6-digit hex colours", () => {
  const declared = [...css.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].filter((m) => m[1] !== "*");
  expect(declared.length).toBe(tokens.size);
});

for (const theme of ["slip", "kiln"] as const) {
  test.each(cases)(`${theme}: %s on %s is at least %d:1`, (fg, bg, min) => {
    const f = tokens.get(fg);
    const b = tokens.get(bg);
    expect(f, `token ${fg}`).toBeDefined();
    expect(b, `token ${bg}`).toBeDefined();
    const r = ratio(f![theme], b![theme]);
    expect(r, `${theme}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
  });
}
