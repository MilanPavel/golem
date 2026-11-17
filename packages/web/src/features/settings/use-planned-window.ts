import { windowCaption } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { usePageActions } from "../../store/page-context.tsx";

/** What Auto plans for the local model: the window in tokens, and the sentence that says so. Both null when golem has no plan. */
export function usePlannedWindow(local: string | null): { planned: number | null; note: string | null } {
  const actions = usePageActions();
  const options = useQuery({
    queryKey: ["model.options", local],
    queryFn: () => actions.modelOptions(local ?? "", null),
    enabled: local !== null,
    retry: false,
    staleTime: 60_000,
  });
  const planned = options.data?.default_from?.["num_ctx"] === "golem" ? Number(options.data.defaults["num_ctx"] ?? Number.NaN) || null : null;
  const note = planned === null ? null : windowCaption(local, planned, options.data?.memory?.ram_gb ?? null);
  return { planned, note };
}
