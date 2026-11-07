import type { TraceGetResult, TraceModelSpan, TraceRunSpan, TraceTokens, TraceToolSpan } from "@golem/client";

export type { TraceGetResult, TraceModelSpan, TraceRunSpan, TraceTokens, TraceToolSpan };

/** Any span of the tree. */
export type TraceNode = TraceRunSpan | TraceModelSpan | TraceToolSpan;

/**
 * The query key of `trace.get`. Nothing pushed marks it stale: the trace page shows finished data
 * and reads again when the person presses Refresh.
 */
export function traceKey(sessionId: string): readonly unknown[] {
  return ["trace.get", sessionId];
}

/** The spans under `span`: model calls for a run, tool calls for a model call, none for a tool. */
export function childrenOf(span: TraceNode): readonly TraceNode[] {
  return "children" in span ? (span.children ?? []) : [];
}

/** The model calls of a run. */
export function modelsOf(run: TraceRunSpan): readonly TraceModelSpan[] {
  return run.children ?? [];
}

/** The tool calls a model call asked for. */
export function toolsOf(model: TraceModelSpan): readonly TraceToolSpan[] {
  return model.children ?? [];
}
