import type { AgentInfo } from "@golem/client";
import { agentRow, SET_IN_CONFIG, agentWish, wishLine, type AgentRow, type LimitFact, type WishModel, type WishSetup } from "@golem/view";

import type { McpManagerLine } from "./mcp-manager.ts";

/**
 * The read view of one agent in `/agents`: where it comes from and its path, then the model, tools, limits and
 * whether it asks, a rule, and the prompt wrapped to the screen. Pure: the manager scrolls and draws these lines.
 */

const LABEL = 11;

/** The word for how often an agent ran, as the list shows it: `9 runs`, `—`, or `not yet` for an agent that cannot run. */
export function runsText(agent: AgentInfo): string {
  if (agent.unavailable !== null && agent.unavailable !== undefined) {
    return "not yet";
  }
  const used = agent.used ?? 0;
  return used > 0 ? `${used} ${used === 1 ? "run" : "runs"}` : "—";
}

/** `15 tool calls · 5 min · answer 6000 chars`; calls, time and answer say `no … limit` when unset, tokens and cost are left out. */
export function limitsText(facts: readonly LimitFact[]): string {
  return facts
    .filter((fact) => fact.value !== "no limit" || (fact.label !== "tokens" && fact.label !== "cost"))
    .map((fact) => {
      if (fact.value === "no limit") {
        return `no ${fact.label} limit`;
      }
      return fact.label === "time" ? fact.value : fact.label === "answer chars" ? `answer ${fact.value} chars` : `${fact.value} ${fact.label}`;
    })
    .join(" · ");
}

/** The tools, a name that changes things marked with `*`. */
export function toolsText(row: AgentRow): string {
  const changing = new Set(row.changingTools);
  const names = [...row.readingTools, ...row.changingTools];
  return names.length === 0 ? "none" : names.map((name) => (changing.has(name) ? `${name}*` : name)).join(" ");
}

/** The title line: `explorer · bundled · read-only`. */
export function readTitle(row: AgentRow): string {
  return `${row.name} · ${row.mark}${row.source === "bundled" ? " · read-only" : ""}`;
}

/** The lines of the read view, all of them: the screen shows a window of these. */
export function readLines(agent: AgentInfo, input: { width: number; setup: WishSetup; models?: readonly WishModel[] }): McpManagerLine[] {
  const width = Math.max(20, input.width);
  const row = agentRow(agent, input.setup, input.models ?? []);
  const lines: McpManagerLine[] = [{ text: readTitle(row), bold: true }];
  if (row.path !== null) {
    lines.push({ text: row.path, dim: true });
  }
  const fact = (key: string, text: string) => {
    wrapText(text, Math.max(10, width - LABEL)).forEach((part, index) => {
      lines.push({ text: `${index === 0 ? key.padEnd(LABEL) : " ".repeat(LABEL)}${part}` });
    });
  };
  if (row.description.length > 0) {
    wrapText(agent.description.trim(), width).forEach((part) => lines.push({ text: part, dim: true }));
  }
  lines.push({ text: "" });
  fact("model", wishLine(agent.wish, input.setup, agent.resolves_to).replace(/^wish: /, "") || agentWish(agent.wish));
  if (row.now !== null && row.now.reason.length > 0) {
    fact("why", row.now.reason);
  }
  fact("tools", toolsText(row));
  if (row.changingTools.length > 0) {
    fact("", "* changes things");
  }
  fact("limits", limitsText(row.limits));
  if (row.configLimits.length > 0) {
    fact("", `${row.configLimits.join(", ")}: ${SET_IN_CONFIG}`);
  }
  fact("asks", row.asksLine);
  fact("runs", row.usage);
  if (row.unavailable !== null) {
    fact("not yet", row.unavailable);
  }
  if ((agent.shadowed ?? []).length > 0) {
    fact("hides", "the bundled agent of the same name");
  }
  if (row.warnings.length > 0) {
    const bad = row.tone === "bad";
    lines.push({ text: "" }, { text: bad ? "Errors" : "Warnings", bold: true });
    for (const warning of row.warnings) {
      wrapText(warning, Math.max(10, width - 2)).forEach((part, index) => {
        lines.push(index === 0 ? { mark: { text: bad ? "✘" : "!", tone: bad ? "bad" : "wait" }, text: part } : { text: `  ${part}` });
      });
    }
  }
  if (row.prompt !== null) {
    lines.push({ text: "" }, { text: rule("prompt", width), dim: true });
    for (const part of wrapPrompt(row.prompt, width)) {
      lines.push({ text: part });
    }
  }
  return lines;
}

/** `── prompt ─────`, as wide as the screen. */
export function rule(title: string, width: number): string {
  const head = `── ${title} `;
  return head + "─".repeat(Math.max(0, width - head.length));
}

/** Words wrapped to `width`; a word longer than that is cut. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    for (const piece of cut(word, width)) {
      if (current.length > 0 && current.length + 1 + piece.length > width) {
        lines.push(current);
        current = piece;
      } else {
        current = current.length > 0 ? `${current} ${piece}` : piece;
      }
    }
  }
  return current.length > 0 ? [...lines, current] : lines;
}

/** The prompt wrapped to `width`: its own line breaks and blank lines stay, and a line's indent stays on each part. */
export function wrapPrompt(prompt: string, width: number): string[] {
  const out: string[] = [];
  for (const line of prompt.replace(/\r/g, "").trimEnd().split("\n")) {
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    const parts = wrapText(line, Math.max(10, width - indent.length));
    if (parts.length === 0) {
      out.push("");
    }
    for (const part of parts) {
      out.push(`${indent}${part}`);
    }
  }
  return out;
}

function cut(word: string, width: number): string[] {
  const size = Math.max(1, width);
  const parts: string[] = [];
  for (let at = 0; at < word.length; at += size) {
    parts.push(word.slice(at, at + size));
  }
  return parts;
}
