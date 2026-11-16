import { contextActions, windowSourceOf, type ContextAction, type ContextActionId, type WindowSource } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useModelList, usePageActions, useRouting, useSession, useTraceSpan } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";

const selectLast = (view: SessionView) => view.context.last;
const selectModel = (view: SessionView) => view.model;
const selectRoute = (view: SessionView) => view.chat.route.mode;
const selectBusy = (view: SessionView) => view.chat.busy;

/** What the chip's popover and the cut banner show: the rows, the window's source, and the reserve. */
export type ContextActionsView = {
  actions: ContextAction[];
  source: WindowSource;
  reserve: number | null;
};

/**
 * The rows for a session's context, from its last call. Nothing is read until `enabled`: the call's
 * messages, the model list, the keep settings, and (for a local model) this Mac's memory.
 */
export function useContextActions(sessionId: string, enabled: boolean): ContextActionsView {
  const last = useSession(sessionId, selectLast);
  const model = useSession(sessionId, selectModel);
  const route = useSession(sessionId, selectRoute);
  const busy = useSession(sessionId, selectBusy);
  const pageActions = usePageActions();
  // A call is read once its run has ended: the trace is complete only then.
  const span = useTraceSpan(sessionId, enabled && !busy && last !== null ? last.spanId : null);
  const models = useModelList(enabled);
  const routing = useRouting(enabled);
  const name = model?.provider === "ollama" ? model.name : null;
  const options = useQuery({
    queryKey: ["model.options", name, sessionId],
    queryFn: () => pageActions.modelOptions(name ?? "", sessionId),
    enabled: enabled && name !== null,
    retry: false,
  });
  const reserve = span.data?.context?.reserve ?? routing.data?.context.reply_reserve ?? null;
  const source = last === null ? "unknown" : windowSourceOf({ window: last.window, planned: last.windowPlanned, numCtx: last.numCtx });
  const actions = useMemo(
    () =>
      last === null
        ? []
        : contextActions({
            used: last.used,
            window: last.window,
            source,
            session: { profile: model?.profile ?? null, provider: model?.provider ?? null, name: model?.name ?? null },
            models: models.data?.models ?? null,
            messages: span.data?.messages ?? null,
            keepResults: routing.data?.context.keep_results ?? 4,
            keepTurns: routing.data?.context.keep_turns ?? 4,
            memory: options.data?.memory ?? null,
            route,
            changed: last.adjusted === true,
            busy,
          }),
    [last, source, model, models.data, span.data, routing.data, options.data, route, busy],
  );
  return { actions, source, reserve };
}

/**
 * What a row does: clear, summarise or grow through `session.compact`, and a larger model by turning the
 * route to auto, where a paid model asks first. It rejects with the daemon's reason.
 */
export function useRunContextAction(sessionId: string): (id: ContextActionId) => Promise<void> {
  const pageActions = usePageActions();
  return useCallback(
    async (id) => {
      if (id === "larger") await pageActions.setRoute(sessionId, "auto");
      else await pageActions.compact(sessionId, id, null);
    },
    [pageActions, sessionId],
  );
}
