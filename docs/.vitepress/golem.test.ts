import assert from "node:assert/strict";
import { test } from "node:test";
import { GOLEM_CELLS, GOLEM_HEIGHT, GOLEM_WIDTH, faviconHref, golemSvg, markCss } from "./golem.ts";

const palette = {
  "golem-body": { light: "#9C6B3C", dark: "#A8733F" },
  "golem-eye": { light: "#2A1408", dark: "#0E0704" },
};

test("the figure is the TUI's 9×6 grid, with two eyes", () => {
  assert.equal(GOLEM_WIDTH, 9);
  assert.equal(GOLEM_HEIGHT, 6);
  assert.deepEqual(
    GOLEM_CELLS.filter((cell) => cell.eye).map(({ x, y }) => [x, y]),
    [
      [3, 1],
      [5, 1],
    ],
  );
});

test("the SVG has one rect per pixel and crisp edges", () => {
  const svg = golemSvg("#111", "#222");
  assert.equal(svg.match(/<rect /g)?.length, GOLEM_CELLS.length);
  assert.match(svg, /viewBox="0 0 9 6" shape-rendering="crispEdges"/);
  assert.match(svg, /\.b\{fill:#111\}\.e\{fill:#222\}/);
});

test("the favicon switches to kiln when the system is dark", () => {
  const svg = decodeURIComponent(faviconHref(palette).replace("data:image/svg+xml,", ""));
  assert.match(svg, /\.b\{fill:#9C6B3C\}\.e\{fill:#2A1408\}@media \(prefers-color-scheme:dark\)\{\.b\{fill:#A8733F\}/);
});

test("the sidebar mark has a slip and a kiln version", () => {
  const css = markCss(palette);
  assert.match(css, /:root \{\n {2}--golem-mark: url\("data:image\/svg\+xml,.*%239C6B3C/);
  assert.match(css, /html\.dark \{\n {2}--golem-mark: url\("data:image\/svg\+xml,.*%23A8733F/);
  assert.throws(() => markCss({}), /golem-body/);
});
