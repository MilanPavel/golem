// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { FAVICON_COLORS } from "./favicon-colors.ts";

const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");

test("the colours equal the tokens, so they cannot drift", () => {
  for (const [name, [light, dark]] of Object.entries(FAVICON_COLORS)) {
    const match = new RegExp(`--color-${name}:\\s*light-dark\\(\\s*(#[0-9A-Fa-f]{6})\\s*,\\s*(#[0-9A-Fa-f]{6})\\s*\\)`).exec(css);
    expect(match, `token ${name}`).not.toBeNull();
    expect([match?.[1]?.toUpperCase(), match?.[2]?.toUpperCase()]).toEqual([light.toUpperCase(), dark.toUpperCase()]);
  }
});
