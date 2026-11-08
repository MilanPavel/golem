import {
  CONTEXT_KEYS,
  CONTEXT_LABELS,
  contextLevel,
  contextSummary,
  contextUsed,
  contextWarning,
  formatTokens,
  overNumCtx,
  windowUnknownHint,
  type ContextKey,
  type TraceContext,
} from "@golem/view";

/** The class that fills each part of the bar and its swatch. */
export const PART_COLOR: Record<ContextKey, string> = {
  system: "bg-ctx-system",
  tools: "bg-ctx-tools",
  user: "bg-ctx-user",
  assistant: "bg-ctx-replies",
  tool_results: "bg-ctx-results",
};

/** How full a model call's context window was, and what filled it. */
export function ContextMeter({ context, provider }: { context: TraceContext; provider: string | null }) {
  const used = contextUsed(context);
  const size = context.window ?? null;
  const total = Math.max(size ?? 0, used);
  const parts = CONTEXT_KEYS.map((key) => context.parts.find((part) => part.key === key) ?? { key, tokens: 0, chars: 0, items: [] });
  const warning = contextWarning(context);
  const severe = overNumCtx(context) || contextLevel(used, size) === "full";
  const summary = contextSummary(used, size, context.window_estimated ?? false);
  return (
    <section aria-label="Context window" className="flex flex-col gap-2 border-b border-line px-4 py-3">
      <div className="flex items-baseline gap-2">
        <p className="font-mono text-xs text-ink">
          Context · {(context.used ?? null) === null ? "≈" : ""}
          {summary}
          {size === null ? " · window unknown" : ""}
        </p>
        <span className="ml-auto text-xs text-faint" title="The provider reports only the total. golem splits it by characters, about 4 per token.">
          estimated split
        </span>
      </div>
      <div aria-hidden="true" className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-line">
        {parts
          .filter((part) => part.tokens > 0 && total > 0)
          .map((part) => (
            <span key={part.key} className={PART_COLOR[part.key]} style={{ width: `${(part.tokens / total) * 100}%` }} />
          ))}
      </div>
      <ul aria-label="What fills the context" className="flex max-w-sm flex-col gap-0.5 font-mono text-xs">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-xs ${PART_COLOR[part.key]}`} />
            <span className="text-muted">{CONTEXT_LABELS[part.key]}</span>
            {part.key === "tools" ? <span className="text-faint"> · {(part.items ?? []).length} tools</span> : null}
            <span className="ml-auto text-ink tabular-nums">{formatTokens(part.tokens)}</span>
          </li>
        ))}
        {size === null ? null : (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-xs border border-line-strong" />
            <span className="text-muted">{CONTEXT_LABELS.free}</span>
            <span className="ml-auto text-ink tabular-nums">{formatTokens(Math.max(0, size - used))}</span>
          </li>
        )}
      </ul>
      {warning === null ? null : <p className={`text-xs ${severe ? "text-deny" : "text-wait"}`}>{warning}</p>}
      {size === null ? <p className="text-xs text-faint">{windowUnknownHint(provider)}</p> : null}
    </section>
  );
}
