import { DATA_REPORT_WORKFLOW, routineRunsQuery, type RoutineConfigLike } from "@golem/view";
import { useCallback, useMemo } from "react";
import { useNavigate, usePageActions, useRoutineList } from "./page-context.tsx";
import { routinePath } from "./router.ts";

/** What the ⏱ Routine dialog hands over: the routine's name, its fields, and whether a model writes a summary. */
export type QueryRoutineRequest = { name: string; fields: Partial<RoutineConfigLike>; summary: boolean };

/**
 * The routines of the user that run saved queries, and the two things the Queries tab does with them: make one (the
 * data report workflow is added first when a model writes the summary), and open one.
 */
export function useQueryRoutines(source: string, project: string | null = null): {
  /** Every routine of the user, as the list gave it. */
  routines: readonly RoutineConfigLike[];
  /** The routine that runs this saved query, if any. */
  routineOf(saved: string): RoutineConfigLike | undefined;
  names: readonly string[];
  create(request: QueryRoutineRequest): Promise<void>;
  open(name: string): void;
} {
  const list = useRoutineList();
  const actions = usePageActions();
  const navigate = useNavigate();
  const routines = useMemo(() => (list.data?.routines ?? []).filter((each) => (each.folder ?? null) === project).map((each) => each.config), [list.data, project]);
  const routineOf = useCallback((saved: string) => routines.find((each) => routineRunsQuery(each, source, saved)), [routines, source]);
  const names = useMemo(() => routines.map((each) => each.name), [routines]);
  const create = useCallback(
    async ({ name, fields, summary }: QueryRoutineRequest) => {
      // The daemon edits only the user's config.toml, and a project's source is found through its project.
      if (project !== null) throw new Error(`${source} belongs to the project ${project}, and a project's routines are written in that project's .golem/config.toml. Copy the lines under "What it writes" there.`);
      if (summary) {
        try {
          await actions.addWorkflowStarter(DATA_REPORT_WORKFLOW, null);
        } catch (failed) {
          // The workflow is there already: use it as it is.
          if (!(failed instanceof Error && /exists already/.test(failed.message))) throw failed;
        }
      }
      await actions.saveRoutine(name, fields, true);
    },
    [actions, project, source],
  );
  const open = useCallback(
    (name: string) => {
      navigate(routinePath(name));
    },
    [navigate],
  );
  return { routines, routineOf, names, create, open };
}
