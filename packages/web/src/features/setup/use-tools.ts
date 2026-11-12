import {
  formatLogLine,
  toolsAdded,
  toolsFailed,
  toolsOffer,
  toolsRetry,
  toolsRuntimeDone,
  toolsRuntimeOutput,
  toolsSetToken,
  toolsSkipRow,
  toolsStart,
  toolsStep,
  toolsTick,
  toolsTokenCancelled,
  type ToolsEffect,
  type ToolsState,
} from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions, useMcpCatalog } from "../../store/page-context.tsx";

/** A row's log, as the failed card shows it. */
export type ToolsLog = { kind: "loading" } | { kind: "lines"; lines: readonly string[] } | { kind: "error"; text: string };

export type ToolsController = {
  /** Null until the catalog has been read. */
  state: ToolsState | null;
  /** The catalog could not be read. */
  failed: boolean;
  /** The token being typed in the field under the offer. Held here until Add, then handed to the model and cleared. */
  draft: string;
  logs: Readonly<Record<string, ToolsLog>>;
  setDraft: (text: string) => void;
  tick: (id: string) => void;
  /** Add the ticked servers. False when nothing is ticked, so the caller can go on instead. */
  start: () => boolean;
  /** A new token for a failed row, or null to try again with the one it has. */
  retry: (id: string, token: string | null) => void;
  skipRow: (id: string) => void;
  showLog: (id: string) => void;
};

const noop = (): void => undefined;

/**
 * The Tools panel's state and its work, shared by `/welcome` and Settings → Setup. The model is
 * `@golem/view`'s; this hook does what its effects name: install Node or uv, add the server,
 * and try it for its tool count and its one hint. A token is held only until the call that uses
 * it, and every server is added `on_demand` by the daemon's catalog add.
 */
export function useTools({ mode, enabled }: { mode: ToolsState["mode"]; enabled: boolean }): ToolsController {
  const actions = usePageActions();
  const catalog = useMcpCatalog(null, enabled);
  const [state, setState] = useState<ToolsState | null>(null);
  const [draft, setDraft] = useState("");
  const [logs, setLogs] = useState<Readonly<Record<string, ToolsLog>>>({});
  const mounted = useRef(true);
  const running = useRef(new Set<string>());
  // Servers that were added but did not pass the test. A new try removes the old one first.
  const left = useRef(new Set<string>());
  const entries = catalog.data?.entries;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (state === null && entries !== undefined) setState(toolsOffer(entries, mode));
  }, [state, entries, mode]);

  const change = useCallback((update: (current: ToolsState) => ToolsState): void => {
    if (mounted.current) setState((current) => (current === null ? current : update(current)));
  }, []);

  const run = useCallback(
    (effect: Exclude<ToolsEffect, { kind: "none" }>, name: string): void => {
      const key = effect.kind === "install" ? `install:${effect.runtime}` : `add:${effect.id}`;
      if (running.current.has(key)) return;
      running.current.add(key);
      const finish = (): void => {
        running.current.delete(key);
      };
      if (effect.kind === "install") {
        const { runtime } = effect;
        const label = runtime === "node" ? "Node" : "uv";
        const done = (ok: boolean, reason: string | null): void => {
          finish();
          change((current) => toolsRuntimeDone(current, runtime, ok, reason));
        };
        actions
          .installRuntime(runtime, (event) => {
            if (event.kind === "output") change((current) => toolsRuntimeOutput(current, runtime, event.text));
            else if (event.kind === "error") done(false, event.message);
            else done(event.code === 0 && !event.stopped, event.stopped ? `the ${label} install was stopped` : null);
          })
          .then(
            (started) => {
              if (!started) done(false, `${label} is already being installed`);
            },
            (error: unknown) => {
              done(false, actionErrorText(error, `Could not install ${label}.`));
            },
          );
        return;
      }
      const { id, params } = effect;
      void (async () => {
        try {
          if (left.current.has(name)) {
            await actions.removeMcp(name).catch(noop);
            left.current.delete(name);
          }
          await actions.addMcp(params);
        } catch (error) {
          finish();
          change((current) => toolsFailed(current, id, actionErrorText(error, `Could not add ${name}.`)));
          return;
        }
        try {
          const result = await actions.testMcp(name, null, noop);
          finish();
          if (result.ok) {
            change((current) => toolsAdded(current, id, result.tools?.length ?? 0));
          } else {
            left.current.add(name);
            change((current) => toolsFailed(current, id, result.hint ?? "the server did not start"));
          }
        } catch (error) {
          finish();
          left.current.add(name);
          change((current) => toolsFailed(current, id, actionErrorText(error, `Could not try ${name}.`)));
        }
      })();
    },
    [actions, change],
  );

  // One effect at a time: the model says what is next, and the state it hands back marks the row busy.
  useEffect(() => {
    if (state === null) return;
    const next = toolsStep(state);
    if (next.effect.kind === "none") return;
    const { effect } = next;
    const row = effect.kind === "add" ? state.rows.find((each) => each.id === effect.id) : undefined;
    setState(next.state);
    run(effect, row?.entry.name ?? "");
  }, [state, run]);

  const tick = useCallback(
    (id: string): void => {
      change((current) => {
        if (current.phase !== "token") return toolsTick(current, id);
        if (current.tokenFor === id) return toolsTokenCancelled(current);
        // Another row: the token typed so far is kept for its server, then the row is ticked.
        return toolsTick(toolsSetToken(current, current.tokenFor ?? "", draft), id);
      });
      setDraft("");
    },
    [change, draft],
  );

  const start = useCallback((): boolean => {
    if (state === null) return false;
    const committed = state.phase === "token" ? toolsSetToken(state, state.tokenFor ?? "", draft) : state;
    setDraft("");
    const started = toolsStart(committed);
    setState(started ?? committed);
    return started !== null;
  }, [state, draft]);

  const retry = useCallback(
    (id: string, token: string | null): void => {
      change((current) => toolsRetry(current, id, token));
    },
    [change],
  );

  const skipRow = useCallback(
    (id: string): void => {
      const name = state?.rows.find((row) => row.id === id)?.entry.name ?? "";
      if (left.current.delete(name)) actions.removeMcp(name).catch(noop);
      change((current) => toolsSkipRow(current, id));
    },
    [actions, change, state],
  );

  const showLog = useCallback(
    (id: string): void => {
      const name = state?.rows.find((row) => row.id === id)?.entry.name;
      if (name === undefined) return;
      setLogs((now) => ({ ...now, [id]: { kind: "loading" } }));
      actions.mcpLogs(name, null).then(
        (result) => {
          if (mounted.current) setLogs((now) => ({ ...now, [id]: { kind: "lines", lines: result.lines.map(formatLogLine) } }));
        },
        (error: unknown) => {
          if (mounted.current) setLogs((now) => ({ ...now, [id]: { kind: "error", text: actionErrorText(error, "Could not read the log.") } }));
        },
      );
    },
    [actions, state],
  );

  return { state, failed: catalog.isError, draft, logs, setDraft, tick, start, retry, skipRow, showLog };
}
