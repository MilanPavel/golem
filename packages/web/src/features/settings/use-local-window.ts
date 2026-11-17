import { localWindow, NO_LOCAL_WINDOW, namesModel, type LocalWindow } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useModelList, usePageActions, useRouting } from "../../store/page-context.tsx";
import { usableModels } from "./routing-derive.ts";

/** The window the local model really gets, and where it comes from: saved, fixed, golem's plan, the Modelfile, Ollama's default. */
export function useLocalWindow(local: string | null): LocalWindow {
  const actions = usePageActions();
  const routing = useRouting();
  const listing = useModelList().data ?? null;
  const options = useQuery({
    queryKey: ["model.options", local],
    queryFn: () => actions.modelOptions(local ?? "", null),
    enabled: local !== null,
    retry: false,
    staleTime: 60_000,
  });
  const setting = routing.data?.context.window;
  if (local === null || setting === undefined) return NO_LOCAL_WINDOW;
  const listed = usableModels(listing).find((item) => namesModel(item, local));
  const data = options.data;
  return localWindow({
    setting,
    options: data === undefined ? null : { saved: data.saved ?? {}, defaults: data.defaults, from: data.default_from?.["num_ctx"] },
    maxCtx: listed?.ctx ?? null,
    size_gb: listed?.size_gb ?? null,
    fit: listed?.fit ?? null,
  });
}
