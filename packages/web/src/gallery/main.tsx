// The entry of the static gallery build (`pnpm build:gallery`), published with the docs at /gallery/.
// The app's own entry, main.tsx, does not import this: the shipped build has no gallery.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/literata";
import "../styles/tokens.css";
import "../styles/prose.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, readTheme } from "../styles/theme.ts";
import { Gallery } from "./gallery.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The page has no #root element.");

applyTheme(readTheme());
createRoot(rootElement).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
