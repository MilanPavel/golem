import { expect, test } from "vitest";
import type { GolemState } from "../../ui/golem-state.ts";
import { CELLS } from "../../ui/pixel-golem.tsx";
import { FAVICON_COLORS } from "./favicon-colors.ts";
import { faviconHref, faviconSvg } from "./favicon.ts";

const FILLS: Record<GolemState, { body: string; eye: string }> = {
  idle: { body: "golem-body", eye: "golem-eye" },
  thinking: { body: "golem-body", eye: "clay" },
  waiting: { body: "golem-body", eye: "wait" },
  failed: { body: "golem-body", eye: "deny" },
  offline: { body: "line-strong", eye: "faint" },
};

function rule(svg: string, cls: string, dark: boolean): string | undefined {
  const [light, darkPart = ""] = svg.split("@media");
  return new RegExp(`\\.${cls}\\{fill:(#[0-9A-Fa-f]{6})\\}`).exec(dark ? darkPart : (light ?? ""))?.[1];
}

test.each(Object.entries(FILLS))("%s favicon has the right body and eye fills", (state, names) => {
  const svg = faviconSvg(state as GolemState);
  const body = FAVICON_COLORS[names.body as keyof typeof FAVICON_COLORS];
  const eye = FAVICON_COLORS[names.eye as keyof typeof FAVICON_COLORS];
  expect(rule(svg, "b", false)).toBe(body[0]);
  expect(rule(svg, "b", true)).toBe(body[1]);
  expect(rule(svg, "e", false)).toBe(eye[0]);
  expect(rule(svg, "e", true)).toBe(eye[1]);
});

test("the favicon draws every cell of the figure with crisp edges", () => {
  const svg = faviconSvg("idle");
  expect(svg).toContain('shape-rendering="crispEdges"');
  expect(svg).toContain('viewBox="0 0 9 6"');
  expect(svg.match(/<rect /g)).toHaveLength(CELLS.length);
  expect(svg.match(/class="e"/g)).toHaveLength(CELLS.filter((cell) => cell.eye).length);
  expect(svg).not.toContain("animation");
});

test("the href is a data URL that decodes to the svg", () => {
  const href = faviconHref("waiting");
  expect(href.startsWith("data:image/svg+xml,")).toBe(true);
  expect(decodeURIComponent(href.slice("data:image/svg+xml,".length))).toBe(faviconSvg("waiting"));
});
