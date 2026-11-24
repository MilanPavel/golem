import { RpcError, type EvalMeasurement, type EvalSummary, type EvalsPlanResult, type GolemClient } from "@golem/client";
import { foldEval, foldLive, type MeasureLive } from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  closedMeasure,
  measureKeyOf,
  measureListed,
  measureNoticed,
  measureOpened,
  openMeasure,
  pressMeasure,
  type MeasureAction,
  type MeasureData,
  type MeasureState,
} from "./measure-manager.ts";
import type { Press } from "./keys.ts";

const LOST = "Could not reach golem.";
const METHOD_NOT_FOUND = -32601;

function failure(error: unknown, fallback: string): string {
  if (error instanceof RpcError && error.code === METHOD_NOT_FOUND) return "This golem is too old to measure. Update golem.";
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/**
 * `/agents`, then `m`: reads `evals.plan` and `evals.list`, follows `eval.*` while the screen is open, and does what
 * a key asks for. Leaving the screen unsubscribes; it never stops a run.
 */
export function useMeasure(client: GolemClient): {
  state: MeasureState;
  data: MeasureData;
  open: () => void;
  press: (press: Press) => void;
} {
  const [state, setState] = useState<MeasureState>(closedMeasure);
  const stateRef = useRef(state);
  const [plan, setPlan] = useState<EvalsPlanResult | null>(null);
  const [list, setList] = useState<readonly EvalSummary[] | null>(null);
  const [measurement, setMeasurement] = useState<EvalMeasurement | null>(null);
  const [live, setLive] = useState<MeasureLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dataRef = useRef<MeasureData>({ plan: null, list: null, measurement: null, live: null, error: null, busy: false });
  dataRef.current = { plan, list, measurement, live, error, busy };
  const openId = useRef<string | null>(null);
  const isOpen = state.open;

  const show = useCallback((next: MeasureState) => {
    stateRef.current = next;
    openId.current = next.run === null ? null : next.run.id;
    setState(next);
  }, []);

  const guard = useCallback(async (work: () => Promise<void>, fallback: string): Promise<boolean> => {
    try {
      await work();
      setError(null);
      return true;
    } catch (caught) {
      setError(failure(caught, fallback));
      return false;
    }
  }, []);

  const loadPlan = useCallback(async () => setPlan(await client.evalsPlan()), [client]);
  const loadList = useCallback(async () => setList((await client.evalsList()).measurements ?? []), [client]);
  const loadOne = useCallback(
    async (id: string) => {
      const result = await client.evalsGet(id);
      if (openId.current === id) setMeasurement(result.measurement);
    },
    [client],
  );
  const refresh = useCallback(() => guard(async () => void (await Promise.all([loadPlan(), loadList()])), LOST), [guard, loadPlan, loadList]);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    return client.onEval((update) => {
      setLive((now) => foldLive(now, update));
      const id = update.kind === "started" ? update.started.id : update.kind === "progress" ? update.progress.id : update.ended.id;
      if (openId.current === id) {
        setMeasurement((now) => foldEval(now, update));
        if (update.kind !== "progress" || update.progress.state !== "running") void guard(() => loadOne(id), LOST);
      }
      if (update.kind !== "progress") void refresh();
    });
  }, [client, isOpen, guard, loadOne, refresh]);

  const work = useCallback(
    async (job: () => Promise<void>, fallback: string) => {
      setBusy(true);
      dataRef.current = { ...dataRef.current, busy: true };
      try {
        const ok = await guard(job, fallback);
        if (!ok) return;
      } finally {
        setBusy(false);
      }
    },
    [guard],
  );

  const act = useCallback(
    (action: MeasureAction) => {
      switch (action.kind) {
        case "none":
          return;
        case "close":
          show(closedMeasure);
          return;
        case "refresh":
          void refresh();
          return;
        case "open":
          setMeasurement(null);
          openId.current = action.id;
          void guard(() => loadOne(action.id), "Could not read this measurement.");
          return;
        case "start":
          void work(async () => {
            const [first, ...rest] = action.arms;
            if (first === undefined) throw new Error("Choose an arm first.");
            const { id } = await client.evalsStart({ arms: [first, ...rest], allow_tight: action.allowTight });
            setMeasurement(null);
            show(measureOpened(stateRef.current, id));
            await Promise.all([loadOne(id), loadList(), loadPlan()]);
          }, "Could not start the measurement.");
          return;
        case "stop":
          void work(async () => void (await client.evalsStop(action.id)), "Could not stop the measurement.");
          return;
        case "resume":
          void work(async () => {
            await client.evalsResume(action.id, action.allowTight);
            await Promise.all([loadOne(action.id), loadList(), loadPlan()]);
          }, "Could not run the rest.");
          return;
        case "apply":
          void work(async () => {
            const result = await client.evalsApply(action.id);
            if (!result.ok) {
              const reasons = (result.errors ?? []).map((each) => each.message).join(" ");
              throw new Error(reasons === "" ? "Could not write the numbers." : `Could not write the numbers. ${reasons}`);
            }
            show(measureNoticed(measureListed(stateRef.current), "The numbers are written to config.toml. See them under Settings › Agents › Rules."));
            await Promise.all([loadList(), loadPlan()]);
          }, "Could not write the numbers.");
          return;
        case "delete":
          void work(async () => {
            await client.evalsDelete(action.id);
            setMeasurement(null);
            show(measureListed(stateRef.current));
            await Promise.all([loadList(), loadPlan()]);
          }, "Could not delete the measurement.");
          return;
      }
    },
    [client, guard, loadList, loadOne, loadPlan, refresh, show, work],
  );

  const press = useCallback(
    (key: Press) => {
      const mapped = measureKeyOf(key);
      if (mapped === null) return;
      const pressed = pressMeasure(stateRef.current, dataRef.current, mapped);
      show(pressed.state);
      act(pressed.action);
    },
    [act, show],
  );

  const open = useCallback(() => {
    setPlan(null);
    setList(null);
    setMeasurement(null);
    setError(null);
    show(openMeasure());
  }, [show]);

  return { state, data: { plan, list, measurement, live, error, busy }, open, press };
}
