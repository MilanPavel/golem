import { expect, test } from "vitest";

const files = import.meta.glob(["../**/*.{ts,tsx,css}", "!../**/no-font-sans.test.ts"], { query: "?raw", import: "default", eager: true });

// tokens.css clears --font-*, so font-sans is undefined and makes no CSS. Geist is font-ui.
test("no source uses font-sans", () => {
  const hits = Object.entries(files)
    .filter(([, text]) => /\bfont-sans\b/.test(text as string))
    .map(([file]) => file);
  expect(Object.keys(files).length).toBeGreaterThan(100);
  expect(hits).toEqual([]);
});
