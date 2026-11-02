/** The grammars golem ships, by the Shiki id. The loaders are in highlight-engine.ts. */
export type LanguageId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "python"
  | "shellscript"
  | "html"
  | "css"
  | "markdown"
  | "yaml"
  | "toml"
  | "diff"
  | "rust"
  | "go"
  | "sql";

const ALIASES: Record<string, LanguageId> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  python: "python",
  py: "python",
  bash: "shellscript",
  sh: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  html: "html",
  css: "css",
  markdown: "markdown",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  diff: "diff",
  patch: "diff",
  rust: "rust",
  rs: "rust",
  go: "go",
  sql: "sql",
};

/** The grammar for a fence's language name, or null when golem does not highlight it. */
export function languageFor(name: string): LanguageId | null {
  return ALIASES[name.toLowerCase()] ?? null;
}
