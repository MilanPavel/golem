import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, showTheme } from "./gallery-test-utils.ts";

/**
 * Every section of one theme's panel, by the id its heading gives it. `gallery.test.tsx` fails when the
 * gallery has a section that is not in this list, so a new section cannot skip axe.
 */
export const GALLERY_SECTIONS = [
  "trace",
  "button",
  "icon-button",
  "copy",
  "connection-screens",
  "sidebar",
  "folder-browser",
  "setup-form",
  "mcp-servers",
  "tools-panel",
  "welcome-page",
  "download-row",
  "session-title-rename-and-close",
  "empty-screen",
  "dock",
  "dock-slash-commands",
  "approval",
  "input-textarea",
  "card",
  "badge",
  "kbd",
  "status-dot",
  "pixel-golem",
  "tab-icon-and-title",
  "transcript",
  "turn",
  "thinking",
  "diff",
  "drawer",
  "command-palette-and-keys",
  "model-dialog",
  "model-list",
  "dialog-popover-menu-tooltip",
] as const;

/**
 * One axe test per section. Axe reads computed styles node by node, which is slow in jsdom, so one
 * test over the whole gallery outgrew its 60 s on a busy CI runner. The tests are in a file per theme,
 * so vitest runs the two themes in parallel.
 */
export function sectionAxeTests(theme: "slip" | "kiln"): void {
  for (const id of GALLERY_SECTIONS) {
    test(`the gallery's ${id} section in ${theme} passes axe`, async () => {
      showTheme(theme);
      const { container } = render(<Gallery />);
      const section = container.querySelector(`[data-theme="${theme}"] section[id="${id}"]`);
      expect(section, id).toBeTruthy();
      // The trace demos repeat the same "Context window" landmark, and the welcome cases the same "Keep golem
      // one click away" one, and the two import demos the same app names, so unique landmark names are not checked in those.
      const rules = id === "trace" || id === "welcome-page" || id === "mcp-servers" ? { ...DIALOG_RULES, "landmark-unique": { enabled: false } } : DIALOG_RULES;
      await expectAxeClean(section as Element, rules);
    });
  }
}
