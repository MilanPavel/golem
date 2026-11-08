import type { TraceMessage, TraceSpan, TraceSpanResult } from "../../store/trace.ts";
import { formatDuration, formatTokens } from "./format.ts";

export type ModelTab = "context" | "reply" | "metadata";
export type ToolTab = "args" | "result" | "approval";
export type Tab = ModelTab | ToolTab;
export type Mode = "pretty" | "json";

export const NOT_RECORDED_LINE = "Not recorded. This session ran before golem kept traces.";
export const NO_SYSTEM_PROMPT_LINE = "No system prompt was sent on this call. golem sends one only when a skill is pinned.";

/** Lines a tool result shows before it folds. */
export const FOLD_LINES = 20;

/** The tabs a span has, in order. A tool's Approval tab is there only when the call had one. */
export function tabsOf(result: TraceSpanResult): readonly Tab[] {
  if (result.span.kind === "model") return ["context", "reply", "metadata"];
  if (result.span.kind === "tool") return result.approval ? ["args", "result", "approval"] : ["args", "result"];
  return [];
}

export const TAB_LABEL: Record<Tab, string> = {
  context: "Context",
  reply: "Reply",
  metadata: "Metadata",
  args: "Args",
  result: "Result",
  approval: "Approval",
};

/** The name each tool result is labelled with: the call that asked for it, found by `call_id`. */
export function toolNames(messages: readonly TraceMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      const id = call["call_id"];
      if (typeof id === "string" && typeof call["name"] === "string") names.set(id, call["name"]);
    }
  }
  return names;
}

/** `you`, `golem`, or the tool's name. */
export function labelOf(message: TraceMessage, names: ReadonlyMap<string, string>): string {
  if (message.role === "user") return "you";
  if (message.role === "assistant") return "golem";
  return (message.call_id ? names.get(message.call_id) : undefined) ?? "tool";
}

/** `→ name(key=value, …)`, with each value as JSON. */
export function callLine(call: Record<string, unknown>): string {
  const args = call["args"];
  const body =
    args !== null && typeof args === "object"
      ? Object.entries(args as Record<string, unknown>)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(", ")
      : "";
  return `→ ${String(call["name"])}(${body})`;
}

/** How a tool arguments value reads in a list: text as it is, anything else as JSON. */
export function showValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "—";
  return JSON.stringify(value) ?? "—";
}

function dash(value: unknown): string {
  return value === null || value === undefined ? "—" : showValue(value);
}

/** Every field of the span, plus the model's provider and why it stopped, as label and value. */
export function metadataRows(result: TraceSpanResult): [string, string][] {
  const span: TraceSpan = result.span;
  const rows: [string, unknown][] = [
    ["id", span.id],
    ["kind", span.kind],
    ["name", span.name],
    ["status", span.status],
    ["start", span.start],
    ["end", span.end],
    ["duration_ms", span.duration_ms],
    ["model", span.model],
    ["provider", result.provider],
    ["stop_reason", result.stop_reason],
    ["first_token_ms", span.first_token_ms],
    ["tokens.input", span.tokens?.input],
    ["tokens.output", span.tokens?.output],
    ["tokens.cache_read", span.tokens?.cache_read],
    ["tokens.cache_write", span.tokens?.cache_write],
    ["approval_wait_ms", span.approval_wait_ms],
    ["recorded", span.recorded ?? true],
    ["preview", span.preview],
  ];
  return rows.map(([label, value]) => [label, dash(value)]);
}

/** The raw part of the result that a tab shows. */
export function jsonOf(result: TraceSpanResult, tab: Tab): unknown {
  switch (tab) {
    case "context":
      return {
        system_prompt: result.system_prompt ?? null,
        system_sections: result.system_sections ?? null,
        tools: result.tools ?? null,
        messages: result.messages ?? [],
        new_from: result.new_from ?? null,
      };
    case "reply":
      return result.reply ?? null;
    case "metadata":
      return { span: result.span, provider: result.provider ?? null, stop_reason: result.stop_reason ?? null };
    case "args":
      return result.args ?? null;
    case "result":
      return { result: result.result ?? null, artifact_id: result.artifact_id ?? null };
    case "approval":
      return result.approval ?? null;
  }
}

export function jsonText(result: TraceSpanResult, tab: Tab): string {
  return JSON.stringify(jsonOf(result, tab), null, 2);
}

function plainMessage(message: TraceMessage, names: ReadonlyMap<string, string>): string {
  const lines = [message.text, ...(message.tool_calls ?? []).map(callLine)].filter((line) => line !== "");
  return `${labelOf(message, names)}: ${lines.join("\n")}`;
}

/** What a tab shows in Pretty, as plain text, for Copy. */
export function prettyText(result: TraceSpanResult, tab: Tab): string {
  const messages = result.messages ?? [];
  const names = toolNames(messages);
  switch (tab) {
    case "context": {
      const parts: string[] = [];
      if (result.system_prompt) parts.push(`System prompt:\n${result.system_prompt}`);
      if (result.tools) parts.push(`Tools: ${result.tools.length}`);
      messages.forEach((message, index) => {
        if (index === result.new_from && index > 0) parts.push("--- new since the last call ---");
        parts.push(plainMessage(message, names));
      });
      return parts.join("\n\n");
    }
    case "reply":
      return result.reply ? plainMessage(result.reply, names) : "";
    case "metadata":
      return metadataRows(result)
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n");
    case "args":
      return Object.entries(result.args ?? {})
        .map(([key, value]) => `${key}: ${showValue(value)}`)
        .join("\n");
    case "result":
      return result.result ?? "";
    case "approval":
      return Object.entries(result.approval ?? {})
        .map(([key, value]) => `${key}: ${dash(value)}`)
        .join("\n");
  }
}

/** The text Copy puts on the clipboard. */
export function copyText(result: TraceSpanResult, tab: Tab, mode: Mode): string {
  return mode === "json" ? jsonText(result, tab) : prettyText(result, tab);
}

/** `ollama/qwen3-coder:30b · 4.7s · first token 820ms · 9.6K → 612`, and the cache when there is some. */
export function modelLine(result: TraceSpanResult): string {
  const { span } = result;
  const parts: string[] = [];
  if (span.model) parts.push(result.provider && !span.model.startsWith(`${result.provider}/`) ? `${span.model} (${result.provider})` : span.model);
  parts.push(formatDuration(span.duration_ms));
  if (span.first_token_ms !== null && span.first_token_ms !== undefined) parts.push(`first token ${formatDuration(span.first_token_ms)}`);
  const { input, output, cache_read: read, cache_write: write } = span.tokens ?? {};
  if (input !== null && input !== undefined && output !== null && output !== undefined) parts.push(`${formatTokens(input)} → ${formatTokens(output)}`);
  if (read) parts.push(`cache read ${formatTokens(read)}`);
  if (write) parts.push(`cache write ${formatTokens(write)}`);
  return parts.join(" · ");
}

/**
 * The system prompt cut into its sections. The daemon joins them with a blank line and counts
 * code points, so the cut counts code points too. Null when the numbers do not match: show the
 * prompt whole, never a wrong split.
 */
export function promptSections(prompt: string, sections: readonly { name: string; chars: number }[] | null | undefined): { name: string; text: string }[] | null {
  if (!sections || sections.length === 0) return null;
  const points = Array.from(prompt);
  const total = sections.reduce((sum, s) => sum + s.chars, 0) + 2 * (sections.length - 1);
  if (total !== points.length) return null;
  let at = 0;
  return sections.map((s) => {
    const text = points.slice(at, at + s.chars).join("");
    at += s.chars + 2;
    return { name: s.name, text };
  });
}

/** `pinned_skills` is `Pinned skills`, and `section_2` is `Section 2`. */
export function sectionLabel(name: string): string {
  const spaced = name.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The tokens of one prompt section, from the context's `system` part, or null. */
export function sectionTokens(result: TraceSpanResult, name: string): number | null {
  const part = result.context?.parts.find((p) => p.key === "system");
  return part?.items?.find((item) => item.name === name)?.tokens ?? null;
}

/** The tokens a call took in: the context's own count, else the sum of its parts, else the sum of the messages. */
// `contextUsed` from `@golem/view` replaces this once it is available.
export function usedTokens(result: TraceSpanResult): number | null {
  const context = result.context;
  if (context) {
    if (context.used !== null && context.used !== undefined) return context.used;
    return context.parts.reduce((sum, p) => sum + p.tokens, 0);
  }
  let sum: number | null = null;
  for (const m of result.messages ?? []) if (typeof m.tokens === "number") sum = (sum ?? 0) + m.tokens;
  return sum;
}
