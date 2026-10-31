import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/literata";
import "./styles/tokens.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { applyTheme, readTheme } from "./styles/theme.ts";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

applyTheme(readTheme());

// The primitives gallery is for development only. The condition is false in a build,
// so the bundler drops the import and the gallery is not in dist.
const Gallery = import.meta.env.DEV
  ? lazy(() => import("./gallery/gallery.tsx").then((m) => ({ default: m.Gallery })))
  : null;
const showGallery = import.meta.env.DEV && location.pathname === "/gallery";

createRoot(root).render(
  <StrictMode>
    {showGallery && Gallery ? (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
