import { APPROVAL_KEYS } from "../approval/index.ts";
import { sendKeys } from "../composer/send-hint.ts";
import { sendKeyStore } from "../chat/chat-choices.ts";
import { modShortcut } from "../../ui/platform.ts";

export type KeyRow = { keys: readonly string[]; label: string };
export type KeySection = { title: string; note?: string; rows: readonly KeyRow[] };

/** The page's keys, for the Keys dialog. Read when it renders, because ⌘ or Ctrl depends on the platform. */
export function keySections(): KeySection[] {
  return [
    {
      title: "Page",
      rows: [
        { keys: [modShortcut("K")], label: "the palette" },
        { keys: [modShortcut(".")], label: "the trace inspector, in a session" },
        { keys: [modShortcut("B")], label: "hide or show the sidebar" },
        { keys: ["?"], label: "this list" },
        { keys: ["Esc"], label: "close a dialog or the inspector" },
      ],
    },
    {
      title: "Composer",
      rows: [
        { keys: [sendKeys(sendKeyStore.getSnapshot()).send], label: "send" },
        { keys: [sendKeys(sendKeyStore.getSnapshot()).newLine], label: "new line" },
        { keys: ["↑↓"], label: "earlier messages" },
        { keys: ["/"], label: "commands" },
        { keys: ["Tab"], label: "complete a command" },
        { keys: ["Esc"], label: "stop the answer" },
      ],
    },
    {
      title: "Approval",
      note: "While one waits and the message box is empty and not focused.",
      rows: APPROVAL_KEYS.map((entry) => ({ keys: [entry.shown], label: entry.label })),
    },
    {
      title: "Model dialog",
      rows: [
        { keys: ["↑↓"], label: "move" },
        { keys: ["↵"], label: "use or download" },
        { keys: ["Esc"], label: "clear the search, then close" },
      ],
    },
  ];
}
