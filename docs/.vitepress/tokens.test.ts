import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { checkTokens, parseTokens, tokensCss } from "./tokens.ts";

const sample = `@theme {
  --color-*: initial;
  --color-bg: light-dark(#F3F2EF, #15120F);
  --color-clay-ink: light-dark( #94501E ,#E6A06A );
  --font-ui: "Geist Variable", sans-serif;
}`;

test("reads each light-dark colour, and nothing else", () => {
  assert.deepEqual(parseTokens(sample), {
    bg: { light: "#F3F2EF", dark: "#15120F" },
    "clay-ink": { light: "#94501E", dark: "#E6A06A" },
  });
});

test("a missing token fails with its name", () => {
  assert.throws(() => checkTokens(parseTokens(sample), ["bg", "clay", "wait"]), /--color-clay, --color-wait/);
  assert.doesNotThrow(() => checkTokens(parseTokens(sample), ["bg"]));
});

test("writes slip on :root and kiln on html.dark", () => {
  const css = tokensCss(parseTokens(sample));
  assert.match(css, /:root \{\n {2}--golem-bg: #F3F2EF;\n {2}--golem-clay-ink: #94501E;\n\}/);
  assert.match(css, /html\.dark \{\n {2}--golem-bg: #15120F;/);
});

test("the web UI's tokens.css has every token the docs use", () => {
  const css = fs.readFileSync(new URL("../../packages/web/src/styles/tokens.css", import.meta.url), "utf8");
  assert.doesNotThrow(() => checkTokens(parseTokens(css)));
});
