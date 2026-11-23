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
  "sessions-panel",
  "helpers-in-the-list",
  "helper-card",
  "routines",
  "runs",
  "rail",
  "sessions-flyout",
  "inbox-panel",
  "folder-browser",
  "folder-menu",
  "setup-form",
  "mcp-servers",
  "skills",
  "agents",
  "agent-limits",
  "use-helpers",
  "memory",
  "chat-stage",
  "settings-chat",
  "settings-models",
  "routing",
  "settings-context",
  "usage",
  "tools-panel",
  "mcp-sign-in",
  "mcp-token",
  "welcome-page",
  "download-row",
  "session-title-rename-and-close",
  "empty-screen",
  "dock",
  "composer-row",
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
  "type",
  "thinking",
  "cost",
  "routed-answers",
  "cut-reply",
  "writing-a-file",
  "plan-card",
  "diff",
  "todo-list",
  "workbench",
  "batch-card",
  "branch-chip-and-menu",
  "steps-tab",
  "runs-helpers",
  "helper-panel",
  "helper-banner-receipt",
  "changes-tab",
  "files-tab",
  "changes-by-turn",
  "checks-strip",
  "checks-tab",
  "checks-question",
  "commit-dialog",
  "undo-dialogs",
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
      // one click away" one, and the two import demos the same app names, and the three Finished helpers demos the same block, so unique landmark names are not checked in those.
      const rules = id === "trace" || id === "dock" || id === "routing" || id === "settings-context" || id === "workbench" || id === "helper-panel" || id === "helper-banner-receipt" || id === "welcome-page" || id === "mcp-servers" || id === "agents" || id === "agent-limits" || id === "use-helpers" ? { ...DIALOG_RULES, "landmark-unique": { enabled: false } } : DIALOG_RULES;
      await expectAxeClean(section as Element, rules);
    });
  }
}
