import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/literata";
import "./styles/tokens.css";
import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { bootPage } from "./store/boot.ts";
import { PageProvider } from "./store/page-context.tsx";
import { applyTheme, readTheme } from "./styles/theme.ts";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The page has no #root element.");
const root: HTMLElement = rootElement;

applyTheme(readTheme());

// The primitives gallery is for development only. The condition is false in a build,
// so the bundler drops the import and the gallery is not in dist.
const Gallery = import.meta.env.DEV
  ? lazy(() => import("./gallery/gallery.tsx").then((m) => ({ default: m.Gallery })))
  : null;
const showGallery = import.meta.env.DEV && location.pathname === "/gallery";

function render(content: ReactNode): void {
  createRoot(root).render(<StrictMode>{content}</StrictMode>);
}

if (showGallery && Gallery) {
  render(
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>,
  );
} else {
  void bootPage().then((page) => {
    page.start();
    render(
      <PageProvider page={page}>
        <App />
      </PageProvider>,
    );
  });
}
