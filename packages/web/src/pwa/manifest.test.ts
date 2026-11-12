// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};
const html = read("index.html");
const bg = /--color-bg:\s*light-dark\(\s*(#[0-9A-Fa-f]{6})\s*,\s*(#[0-9A-Fa-f]{6})\s*\)/.exec(
  read("src/styles/tokens.css"),
);
const [light, dark] = [bg?.[1]?.toUpperCase(), bg?.[2]?.toUpperCase()];

test("the manifest says what the ticket says", () => {
  expect(manifest).toMatchObject({
    name: "golem",
    short_name: "golem",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
});

test("every icon exists, with a 192 and a 512 any icon and a maskable one", () => {
  for (const icon of manifest.icons) {
    expect(existsSync(new URL(`../../public${icon.src}`, import.meta.url)), icon.src).toBe(true);
    expect(icon.type).toBe("image/png");
  }
  const any = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
  expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
});

test("the manifest colours are the light page background", () => {
  expect(light).toBeDefined();
  expect(manifest.theme_color.toUpperCase()).toBe(light);
  expect(manifest.background_color.toUpperCase()).toBe(light);
});

test("the two theme-color metas are the two page backgrounds", () => {
  const metas = [...html.matchAll(/<meta name="theme-color" media="\(prefers-color-scheme: (\w+)\)" content="(#[0-9A-Fa-f]{6})"/g)];
  expect(Object.fromEntries(metas.map((m) => [m[1], m[2]?.toUpperCase()]))).toEqual({ light, dark });
});

test("index.html links the manifest and the touch icon, and has one icon link for the tab status", () => {
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  expect(html).toContain('<meta name="apple-mobile-web-app-title" content="golem" />');
  const icons = [...html.matchAll(/<link\s[^>]*rel="([^"]*)"/g)].filter((m) => (m[1] ?? "").split(/\s+/).includes("icon"));
  expect(icons).toHaveLength(1);
});
