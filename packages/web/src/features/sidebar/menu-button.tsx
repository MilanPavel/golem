import { HEADER_ROW } from "../../ui/header-row.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { MenuIcon } from "../../ui/icons.tsx";
import { useLayoutMode } from "./layout-mode.ts";
import { useSidebarOverlay } from "./sidebar-overlay.ts";

/** What the sidebar returns focus to when Esc closes it on a narrow window. */
export const MENU_BUTTON_ATTR = "data-sidebar-menu";

/** The ☰ in the page's top bar. Only the narrow layout has it: it opens the rail and the panel together. */
export function MenuButton() {
  const mode = useLayoutMode();
  const [open, setOpen] = useSidebarOverlay();
  if (mode !== "narrow") return null;
  return (
    <IconButton label="Open sidebar" aria-expanded={open} aria-haspopup="dialog" {...{ [MENU_BUTTON_ATTR]: "" }} onClick={() => setOpen(true)}>
      <MenuIcon />
    </IconButton>
  );
}

/** A slim top bar that holds only the ☰, for pages with no top bar of their own. Nothing unless the layout is narrow. */
export function MenuBar() {
  const mode = useLayoutMode();
  if (mode !== "narrow") return null;
  return (
    <header className={`${HEADER_ROW} px-4`}>
      <MenuButton />
    </header>
  );
}
