import type { ArtifactReadResult, TraceContextEvent, TraceGetResult, TraceHelperModelSpan, TraceHelperToolSpan, TraceMessage, TraceModelSpan, TraceRunSpan, TraceSpan, TraceSpanResult, TraceTokens, TraceToolSpan, TraceRoute } from "@golem/client";

export type { ArtifactReadResult, TraceContextEvent, TraceGetResult, TraceHelperModelSpan, TraceHelperToolSpan, TraceMessage, TraceModelSpan, TraceRunSpan, TraceSpan, TraceSpanResult, TraceTokens, TraceToolSpan, TraceRoute };

/** Any span of the tree. */
export type TraceNode = TraceRunSpan | TraceModelSpan | TraceToolSpan | TraceHelperModelSpan | TraceHelperToolSpan;

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
export function toolsOf(model: TraceModelSpan | TraceHelperModelSpan): readonly (TraceToolSpan | TraceHelperToolSpan)[] {
  return model.children ?? [];
}

/**
 * The model calls of the helper a `delegate` call started, in order. They have a context of their
 * own, so the run's context numbers leave them out, but its totals count them.
 */
export function helperModelsOf(tool: TraceToolSpan | TraceHelperToolSpan): readonly TraceHelperModelSpan[] {
  return "children" in tool ? (tool.children ?? []) : [];
}

/** The model calls of a run, then those of its helpers. */
export function withHelperModels(run: TraceRunSpan): readonly (TraceModelSpan | TraceHelperModelSpan)[] {
  return modelsOf(run).flatMap((model) => [model, ...toolsOf(model).flatMap(helperModelsOf)]);
}

/** The query key of `trace.span`. The page's Refresh reads it again with the tree. */
export function traceSpanKey(sessionId: string, spanId: string): readonly unknown[] {
  return ["trace.span", sessionId, spanId];
}

/** The query key of one artifact, read in pages. */
export function artifactKey(sessionId: string, artifactId: string): readonly unknown[] {
  return ["artifact.read", sessionId, artifactId];
}

/** Characters one page of an artifact holds. */
export const ARTIFACT_PAGE = 20_000;
