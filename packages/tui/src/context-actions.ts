import type { GolemClient, TraceSpanResult } from "@golem/client";
import {
  actionForKey,
  contextActions,
  contextKeyRow,
  windowSourceOf,
  type ContextAction,
  type RouteMode,
} from "@golem/view";

import type { Press } from "./keys.ts";

/** What `/context` knows when it reads the actions: the session, and what the last call said. */
export type ContextActionsRead = {
  sessionId: string;
  session: { profile: string | null; provider: string | null; name: string | null };
  route: RouteMode;
  busy: boolean;
  /** A clear or a summary changed the context after the last call. */
  changed: boolean;
  span: Pick<TraceSpanResult, "messages" | "context">;
};

/**
 * The rows of the `/context` key row. The model list, the keep settings and this Mac's memory are read
 * here; one that cannot be read is left out, and its row says less rather than fail.
 */
export async function readContextActions(
  client: Pick<GolemClient, "listModels" | "getRouting" | "getModelOptions">,
  read: ContextActionsRead,
): Promise<ContextAction[]> {
  const ctx = read.span.context ?? null;
  const name = read.session.provider === "ollama" ? read.session.name : null;
  const [models, routing, options] = await Promise.all([
    client.listModels(false).then((listed) => listed.models, () => null),
    client.getRouting().then((value) => value.context, () => null),
    name === null ? Promise.resolve(null) : client.getModelOptions(name, read.sessionId).then((value) => value.memory ?? null, () => null),
  ]);
  const window = ctx?.window ?? null;
  return contextActions({
    used: ctx?.used ?? null,
    window,
    source: windowSourceOf({ window, planned: ctx?.window_planned ?? false, numCtx: ctx?.num_ctx ?? null }),
    session: read.session,
    models,
    messages: read.span.messages ?? null,
    keepResults: routing?.keep_results ?? 4,
    keepTurns: routing?.keep_turns ?? 4,
    memory: options,
    route: read.route,
    changed: read.changed,
    busy: read.busy,
  });
}

/** The line under the report: `c clear old results · s summarise · g grow to 64K · m larger model`. Null when none can run. */
export function contextKeyLine(actions: readonly ContextAction[]): string | null {
  const row = contextKeyRow(actions);
  return row === "" ? null : row;
}

/** The row a plain key press runs while the panel is open, or null. Keys with Ctrl or Alt never do. */
export function contextRowForPress(actions: readonly ContextAction[], press: Pick<Press, "name" | "input" | "ctrl" | "meta">): ContextAction | null {
  if (press.name !== null || press.ctrl || press.meta) return null;
  return actionForKey(actions, press.input);
}
