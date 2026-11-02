// The palette that config.mts serves from tokens.css.
declare module "virtual:golem-tokens" {
  const palette: import("./tokens.ts").Palette;
  export default palette;
}
declare module "virtual:golem-tokens.css";
// markdown-it and its container plugin, typed with VitePress's own copy of markdown-it's types.
// @types/markdown-it-container still needs @types/markdown-it 13, which does not match.
declare module "markdown-it" {
  const MarkdownIt: new () => import("vitepress").MarkdownRenderer;
  export default MarkdownIt;
}
declare module "markdown-it-container" {
  const container: (
    md: import("vitepress").MarkdownRenderer,
    name: string,
    options: { render(tokens: { info: string; nesting: number }[], idx: number): string },
  ) => void;
  export default container;
}
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
