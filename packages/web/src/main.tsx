import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/literata";
import "./styles/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { applyTheme, readTheme } from "./styles/theme.ts";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

applyTheme(readTheme());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
