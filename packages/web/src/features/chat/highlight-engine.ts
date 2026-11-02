// Everything Shiki is in this file, and it is loaded with import() the first time a finished
// answer has a code block. The JavaScript regex engine needs no WASM, which the CSP forbids.
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { LanguageId } from "./languages.ts";

const THEME = "golem";

// Token colours come out as var(--shiki-token-…); prose.css maps them to golem's tokens.
const theme = createCssVariablesTheme({ name: THEME, variablePrefix: "--shiki-", fontStyle: true });

const LOADERS: Record<LanguageId, () => Promise<{ default: unknown }>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
};

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

const loaded = new Map<LanguageId, Promise<void>>();

function load(core: HighlighterCore, language: LanguageId): Promise<void> {
  let pending = loaded.get(language);
  if (!pending) {
    pending = LOADERS[language]().then((module) =>
      core.loadLanguage(module.default as Parameters<HighlighterCore["loadLanguage"]>[0]),
    );
    loaded.set(language, pending);
  }
  return pending;
}

/** The code as lines of coloured tokens. */
export async function tokenize(code: string, language: LanguageId): Promise<ThemedToken[][]> {
  const core = await getHighlighter();
  await load(core, language);
  return core.codeToTokens(code, { lang: language, theme: THEME }).tokens;
}
