// The palette that config.mts serves from tokens.css.
declare module "virtual:golem-tokens" {
  const palette: import("./tokens.ts").Palette;
  export default palette;
}
declare module "virtual:golem-tokens.css";
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
