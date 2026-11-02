import type { GolemState } from "../../ui/golem-state.ts";

const MARK: Record<GolemState, string> = {
  idle: "",
  thinking: "● ",
  waiting: "! ",
  failed: "✗ ",
  offline: "○ ",
};

function withoutControls(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x1f && (code < 0x7f || code > 0x9f)) {
      out += char;
    }
  }
  return out;
}

/** The tab's title: a mark for the state, then the session's title and "golem". */
export function tabTitle(state: GolemState, sessionTitle: string | null): string {
  const title = withoutControls(sessionTitle ?? "").trim();
  const name = title === "" || title === "untitled" ? "golem" : `${title} · golem`;
  return `${MARK[state]}${name}`;
}
