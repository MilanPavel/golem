import { contextUsed, formatTokens, ownToolName, type TraceContextPart } from "@golem/view";
import type { TraceMessage, TraceSpan, TraceSpanResult } from "../../store/trace.ts";
import { formatDuration, localTime, throughput } from "./format.ts";

type TraceContextItem = NonNullable<TraceContextPart["items"]>[number];

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

const DURATIONS = new Set(["duration_ms", "first_token_ms", "approval_wait_ms"]);
const TIMES = new Set(["start", "end"]);

/** The fields of the span that have a value, plus the model's provider and why it stopped, as label and value. */
export function metadataRows(result: TraceSpanResult): [string, string][] {
  const span: TraceSpan = result.span;
  const window = "context_window" in span ? span.context_window : null;
  const estimated = "context_window_estimated" in span && span.context_window_estimated === true;
  const numCtx = "num_ctx" in span ? span.num_ctx : null;
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
    ["context_window", window === null || window === undefined ? window : `${window}${estimated ? " (estimated)" : ""}`],
    ["num_ctx", numCtx],
    ["approval_wait_ms", span.approval_wait_ms],
    ["recorded", span.recorded ?? true],
    ["preview", span.preview],
  ];
  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]): [string, string] => {
      if (DURATIONS.has(label) && typeof value === "number") return [label, `${value} · ${formatDuration(value)}`];
      if (TIMES.has(label) && typeof value === "string") return [label, localTime(value)];
      return [label, showValue(value)];
    });
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
        context: result.context ?? null,
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
  const speed = throughput(span);
  if (speed !== null) parts.push(`≈ ${speed} tok/s`);
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

/** The tokens a call took in: the context's own count, else the sum of the messages, else null. */
export function usedTokens(result: TraceSpanResult): number | null {
  if (result.context) return contextUsed(result.context);
  let sum: number | null = null;
  for (const m of result.messages ?? []) if (typeof m.tokens === "number") sum = (sum ?? 0) + m.tokens;
  return sum;
}

/** The name the model saw for a tool schema: `function.name`, else `name`, else `tool 3`. */
export function schemaName(schema: Record<string, unknown>, index: number): string {
  const fn = schema["function"];
  const inner = fn !== null && typeof fn === "object" ? (fn as Record<string, unknown>)["name"] : undefined;
  const name = inner ?? schema["name"];
  return typeof name === "string" ? name : `tool ${index + 1}`;
}

export type ToolEntry = { name: string; label: string; tokens: number | null; schema: Record<string, unknown> };
export type ToolGroup = { group: string | null; label: string; tokens: number | null; tools: ToolEntry[] };

function byTokens<T extends { tokens: number | null }>(rows: T[]): T[] {
  // Array.sort is stable, so ties keep schema order.
  return rows.sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1));
}

/** The tool schemas grouped by MCP server (`built-in` for the rest), each with its token cost, largest first. */
export function toolGroups(tools: readonly Record<string, unknown>[], items: readonly TraceContextItem[]): ToolGroup[] {
  const known = new Map(items.map((item) => [item.name, item]));
  const groups = new Map<string | null, ToolEntry[]>();
  tools.forEach((schema, index) => {
    const name = schemaName(schema, index);
    const item = known.get(name);
    const group = item?.group ?? null;
    const entry: ToolEntry = { name, label: group === null ? name : ownToolName(group, name), tokens: item?.tokens ?? null, schema };
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  });
  const rows = [...groups.entries()].map(([group, entries]) => {
    const known = entries.filter((entry) => entry.tokens !== null);
    return {
      group,
      label: group ?? "built-in",
      tokens: known.length === 0 ? null : known.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0),
      tools: byTokens(entries),
    };
  });
  return byTokens(rows);
}
