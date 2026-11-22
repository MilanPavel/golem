import { modShortcut } from "../../ui/platform.ts";
import type { SendKey } from "../chat/chat-choices.ts";

/** The keys that send and add a line, as shown: `↵` and `⇧↵`, or `⌘↵` and `↵` (`Ctrl ↵` off macOS). */
export function sendKeys(sendKey: SendKey): { send: string; newLine: string } {
  return sendKey === "mod" ? { send: modShortcut("↵"), newLine: "↵" } : { send: "↵", newLine: "⇧↵" };
}

/** The line under the composer. While a run goes on it also says how to stop it. */
export function sendHint(sendKey: SendKey, busy: boolean): string {
  const { send, newLine } = sendKeys(sendKey);
  return `${send} send · ${newLine} new line${busy ? " · esc stop" : ""}`;
}
