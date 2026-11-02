// golem's palette has one source: packages/web/src/styles/tokens.css, a Tailwind @theme block
// that VitePress cannot import. The docs read its --color-* lines at build time (ADR-034).

/** One colour in both themes: slip (light) and kiln (dark). */
export interface Token {
  light: string;
  dark: string;
}

export type Palette = Record<string, Token>;

/** The tokens the docs theme uses. A name missing from tokens.css fails the build. */
export const USED = [
  "bg", "surface", "sunken", "ink", "muted", "faint", "line", "line-strong",
  "clay", "clay-ink", "clay-soft", "slip", "golem-body", "golem-eye", "on-clay",
  "allow", "allow-soft", "deny", "deny-soft", "wait", "wait-soft", "code-bg",
] as const;

const LINE = /^\s*--color-([a-z0-9-]+):\s*light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\);/gm;

/** Reads every `--color-<name>: light-dark(<slip>, <kiln>);` line. */
export function parseTokens(css: string): Palette {
  const palette: Palette = {};
  for (const match of css.matchAll(LINE)) {
    const [, name, light, dark] = match;
    if (name && light && dark) palette[name] = { light, dark };
  }
  return palette;
}

/** Fails with every name in `used` that the palette lacks, so a renamed token breaks the build. */
export function checkTokens(palette: Palette, used: readonly string[] = USED): void {
  const missing = used.filter((name) => !(name in palette));
  if (missing.length > 0) {
    throw new Error(
      `tokens.css has no --color-${missing.join(", --color-")}. ` +
        "The docs theme needs them (docs/.vitepress/tokens.ts).",
    );
  }
}

/** The palette as CSS custom properties, `--golem-<name>`, for slip and for kiln. */
export function tokensCss(palette: Palette): string {
  const vars = (side: keyof Token) =>
    Object.entries(palette)
      .map(([name, token]) => `  --golem-${name}: ${token[side]};`)
      .join("\n");
  return `:root {\n${vars("light")}\n}\n\nhtml.dark {\n${vars("dark")}\n}\n`;
}
