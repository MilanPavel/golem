import { CONTEXT_WORDS, localSize, localWindow, namesModel, shortModel, type LocalWindow } from "@golem/view";
import { useQueries } from "@tanstack/react-query";
import { usePageActions, useRouting } from "../../store/page-context.tsx";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import { usableModels } from "./routing-derive.ts";

/** The most rows the table shows. */
export const MAX_WINDOW_ROWS = 12;

/** What is known of one row's window: the answer of `localWindow`, or that the query failed or has not come yet. */
export type ModelWindow = LocalWindow | "failed" | "loading";

/** One local model on this Mac, with what is known of its window. */
export type WindowRow = {
  ref: string;
  name: string;
  sizeGb: number | null;
  inUse: boolean;
  window: ModelWindow;
};

/** The installed Ollama models, the one in use first, at most 12. */
export function localModels(local: string | null, listing: ModelListResult | null): ListedModel[] {
  const installed = usableModels(listing).filter((model) => model.provider === "ollama" && model.source === "installed");
  const inUse = installed.filter((model) => namesModel(model, local));
  return [...inUse, ...installed.filter((model) => !inUse.includes(model))].slice(0, MAX_WINDOW_ROWS);
}

/** Asks `model.options` once per row. The model in use is keyed and asked like `useLocalWindow`, so the two share one answer. */
export function useWindowRows(local: string | null, listing: ModelListResult | null): WindowRow[] {
  const actions = usePageActions();
  const routing = useRouting();
  const setting = routing.data?.context.window;
  const models = localModels(local, listing);
  const refOf = (model: ListedModel) => (namesModel(model, local) && local !== null ? local : model.ref);
  const answers = useQueries({
    queries: models.map((model) => ({
      queryKey: ["model.options", refOf(model)],
      queryFn: () => actions.modelOptions(refOf(model), null),
      retry: false,
      staleTime: 60_000,
    })),
  });
  return models.map((model, index) => {
    const answer = answers[index];
    let window: ModelWindow = "loading";
    if (answer?.isError) window = "failed";
    else if (answer?.data !== undefined && setting !== undefined) {
      const { defaults, default_from, saved } = answer.data;
      window = localWindow({
        setting,
        options: { saved: saved ?? {}, defaults, from: default_from?.["num_ctx"] },
        maxCtx: model.ctx ?? null,
        size_gb: model.size_gb ?? null,
        fit: model.fit ?? null,
      });
    }
    return { ref: model.ref, name: shortModel(model.ref), sizeGb: model.size_gb ?? null, inUse: namesModel(model, local), window };
  });
}

/** The Window cell of a row: the size, where it comes from, and for a dash the reason when there is one. */
export function windowCell(window: ModelWindow): { text: string; note: string | null; title: string | null } {
  if (window === "failed" || window === "loading") return { text: "—", note: null, title: null };
  if (window.tokens === null || window.source === null) return { text: "—", note: null, title: window.reason === null ? null : sentence(window.reason) };
  const text = localSize(window.tokens, window.estimated);
  if (window.source === "fixed") return { text, note: null, title: null };
  return { text, note: CONTEXT_WORDS.sources[window.source], title: null };
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** The window each local model on this Mac gets with the current choice. */
export function WindowTable({ rows }: { rows: readonly WindowRow[] }) {
  const head = "pr-2 pb-2 text-left font-mono text-micro font-semibold tracking-wider text-faint uppercase";
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th scope="col" className={head}>
            Model on this Mac
          </th>
          <th scope="col" className={head}>
            Size
          </th>
          <th scope="col" className={`${head} text-right`}>
            Window
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const cell = windowCell(row.window);
          return (
            <tr key={row.ref} className="border-t border-line">
              <td className="py-2 pr-2 font-mono text-note">
                {row.name}
                {row.inUse ? <span className="ml-2 rounded-xs bg-allow-soft px-1.5 py-0.5 align-middle font-mono text-micro font-semibold text-allow">in use</span> : null}
              </td>
              <td className="py-2 pr-2 font-mono text-note text-muted">{row.sizeGb === null ? "—" : `${row.sizeGb} GB`}</td>
              <td className="py-2 text-right font-mono text-note" title={cell.title ?? undefined}>
                {cell.text}
                {cell.note === null ? null : <span className="block font-sans text-micro text-muted">{cell.note}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
