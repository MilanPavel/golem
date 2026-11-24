import type { EvalMeasurement, EvalSummary, EvalsPlanResult } from "../../store/evals.ts";
import { foldEval, foldLive, runningId, type MeasureLive } from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions } from "../../store/page-context.tsx";
import { showAgentsTab } from "./agents-tab.ts";

/** What the Measure tab knows, and the things it can do. Kept by Settings › Agents, so the tab can show a dot while a run goes on. */
export type Measure = {
  plan: EvalsPlanResult | null;
  list: readonly EvalSummary[] | null;
  /** The id of the measurement that is open, or null for the list. */
  open: string | null;
  measurement: EvalMeasurement | null;
  live: MeasureLive | null;
  /** A plain line when the daemon refused or could not be reached. */
  error: string | null;
  /** True while a call is on its way. */
  busy: boolean;
  /** True while a measurement runs, from any client. */
  running: boolean;
  /** The model chosen for an arm instead of its own. */
  models: Readonly<Record<string, string>>;
  /** Loads the plan and the list again. */
  refresh: () => void;
  chooseModel: (arm: string, model: string) => void;
  start: (arms: string[], allowTight: boolean) => Promise<void>;
  stop: (id: string) => Promise<void>;
  resume: (id: string, allowTight: boolean) => Promise<void>;
  openRun: (id: string) => void;
  toList: () => void;
  /** Writes the numbers and goes to the Rules tab. */
  apply: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const LOST = "Could not reach golem.";

/** Settings › Agents › Measure: reads `evals.plan` and `evals.list`, follows `eval.*`, and does what the buttons say. */
export function useMeasure(): Measure {
  const { evals } = usePageActions();
  const [plan, setPlan] = useState<EvalsPlanResult | null>(null);
  const [list, setList] = useState<readonly EvalSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<EvalMeasurement | null>(null);
  const [live, setLive] = useState<MeasureLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Readonly<Record<string, string>>>({});
  const openRef = useRef<string | null>(null);
  const modelsRef = useRef(models);
  const alive = useRef(true);
  useEffect(() => {
    openRef.current = open;
    modelsRef.current = models;
  }, [open, models]);

  const guard = useCallback(async (work: () => Promise<void>, fallback: string): Promise<void> => {
    try {
      await work();
      if (alive.current) setError(null);
    } catch (failure) {
      if (alive.current) setError(actionErrorText(failure, fallback));
    }
  }, []);

  const loadPlan = useCallback(async (): Promise<void> => {
    const chosen = modelsRef.current;
    const result = Object.keys(chosen).length === 0 ? await evals.evalsPlan() : await evals.evalsPlan(undefined, { ...chosen });
    if (alive.current) setPlan(result);
  }, [evals]);
  const loadList = useCallback(async (): Promise<void> => {
    const result = await evals.evalsList();
    if (alive.current) setList(result.measurements ?? []);
  }, [evals]);
  const loadOne = useCallback(
    async (id: string): Promise<void> => {
      const result = await evals.evalsGet(id);
      if (alive.current && openRef.current === id) setMeasurement(result.measurement);
    },
    [evals],
  );

  const refresh = useCallback(() => {
    void guard(async () => {
      await Promise.all([loadPlan(), loadList()]);
    }, LOST);
  }, [guard, loadPlan, loadList]);

  useEffect(() => {
    alive.current = true;
    // The first read: its answers set state later, not now.
    Promise.all([loadPlan(), loadList()]).catch((failure: unknown) => {
      if (alive.current) setError(actionErrorText(failure, LOST));
    });
    const off = evals.onEval((update) => {
      setLive((now) => foldLive(now, update));
      const id = update.kind === "started" ? update.started.id : update.kind === "progress" ? update.progress.id : update.ended.id;
      if (openRef.current === id) {
        setMeasurement((now) => foldEval(now, update));
        // The numbers of a run that ended (and the proposal of a measurement that ended) come from the daemon.
        const settled = update.kind !== "progress" || update.progress.state !== "running";
        if (settled) void guard(() => loadOne(id), LOST);
      }
      if (update.kind !== "progress") {
        void guard(async () => {
          await Promise.all([loadList(), loadPlan()]);
        }, LOST);
      }
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [evals, guard, loadList, loadOne, loadPlan]);

  const openRun = useCallback(
    (id: string) => {
      setOpen(id);
      openRef.current = id;
      setMeasurement(null);
      void guard(() => loadOne(id), "Could not read this measurement.");
    },
    [guard, loadOne],
  );
  const toList = useCallback(() => {
    setOpen(null);
    openRef.current = null;
    setMeasurement(null);
    setError(null);
    refresh();
  }, [refresh]);

  const run = useCallback(
    async (work: () => Promise<void>, fallback: string): Promise<void> => {
      setBusy(true);
      try {
        await guard(work, fallback);
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [guard],
  );

  const chooseModel = useCallback(
    (arm: string, model: string) => {
      const next = { ...modelsRef.current, [arm]: model };
      modelsRef.current = next;
      setModels(next);
      void guard(loadPlan, LOST);
    },
    [guard, loadPlan],
  );

  const running = runningId(list ?? []) !== null || plan?.running != null;
  return {
    plan,
    list,
    open,
    measurement,
    live,
    error,
    busy,
    running,
    models,
    refresh,
    chooseModel,
    start: (arms, allowTight) =>
      run(async () => {
        const chosen = Object.fromEntries(Object.entries(modelsRef.current).filter(([arm]) => arms.includes(arm)));
        const [first, ...rest] = arms;
        if (first === undefined) throw new Error("Choose an arm first.");
        const { id } = await evals.evalsStart({ arms: [first, ...rest], allow_tight: allowTight, ...(Object.keys(chosen).length === 0 ? {} : { models: chosen }) });
        openRun(id);
        await Promise.all([loadList(), loadPlan()]);
      }, "Could not start the measurement."),
    stop: (id) =>
      run(async () => {
        await evals.evalsStop(id);
      }, "Could not stop the measurement."),
    resume: (id, allowTight) =>
      run(async () => {
        await evals.evalsResume(id, allowTight);
        await Promise.all([loadOne(id), loadList(), loadPlan()]);
      }, "Could not run the rest."),
    openRun,
    toList,
    apply: (id) =>
      run(async () => {
        const result = await evals.evalsApply(id);
        if (!result.ok) {
          const reasons = (result.errors ?? []).map((each) => each.message).join(" ");
          throw new Error(reasons === "" ? "Could not write the numbers." : `Could not write the numbers. ${reasons}`);
        }
        showAgentsTab("rules");
      }, "Could not write the numbers."),
    remove: (id) =>
      run(async () => {
        await evals.evalsDelete(id);
        setOpen(null);
        openRef.current = null;
        setMeasurement(null);
        await Promise.all([loadList(), loadPlan()]);
      }, "Could not delete the measurement."),
  };
}
