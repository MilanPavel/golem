export type CopyMessage = {
  role: string;
  text: string;
};

/** The newest assistant text, or null when there is nothing to copy. */
export function copyAnswer(messages: readonly CopyMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "assistant" && message.text.length > 0) {
      return message.text;
    }
  }
  return null;
}

/** The last fenced block in the transcript. The fence marker and language tag are left out. */
export function copyCode(messages: readonly CopyMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    const block = lastFencedCode(message.text);
    if (block !== null) {
      return block;
    }
  }
  return null;
}

export function lastFencedCode(text: string): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const body = match[1];
    if (body !== undefined) {
      found = body.replace(/\n$/, "");
    }
  }
  return found;
}

/** One markdown document from the messages on screen. */
export function sessionMarkdown(title: string, messages: readonly CopyMessage[]): string {
  const heading = title.trim().length > 0 ? title.trim().replace(/\s+/g, " ") : "untitled";
  const parts = [`# ${heading}`, ""];
  for (const message of messages) {
    if (message.text.length === 0) {
      continue;
    }
    const who = message.role === "user" ? "you" : "golem";
    parts.push(`**${who}**`, "", message.text, "");
  }
  return `${parts.join("\n")}`;
}

export function exportFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .slice(0, 80)
    .trim();
  return `${cleaned.length > 0 ? cleaned : "untitled"}.md`;
}
