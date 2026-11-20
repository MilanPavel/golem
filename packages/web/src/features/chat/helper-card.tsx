import { batchCard, withLocal, type CardTone, type Detail, type HelperBatch, type HelperRef, type IsLocal } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { openHelper } from "./helper-open.ts";

const TONE: Record<CardTone, string> = {
  run: "text-muted",
  ok: "text-allow",
  wait: "text-wait",
  bad: "text-deny",
};

/**
 * The batch card of one `delegate` call (ADR-059), drawn from `batchCard`. Quiet is one grey line.
 * Normal and Verbose list a row per helper; a row is a button that opens the helper in the panel.
 * `refs` are the helper sessions of the call, to find the one a row opens.
 */
export function BatchCardView({ callId, batch, refs, detail, isLocal }: { callId: string; batch: HelperBatch; refs: readonly HelperRef[]; detail: Detail; isLocal?: IsLocal }) {
  const told = isLocal === undefined ? batch : withLocal(batch, isLocal);
  const card = batchCard(told, detail);
  if (detail === "quiet") {
    return (
      <p data-batch-card data-detail="quiet" className="font-mono text-xs text-muted">
        <span className="text-faint">{card.head}</span>
      </p>
    );
  }
  return (
    <div role="group" aria-label="Helpers" data-batch-card data-detail={detail} className="flex min-w-0 flex-col rounded-md border border-line bg-sunken font-mono text-xs leading-snug">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-muted">
        <span>{card.total ?? card.head}</span>
        <span className={cn("whitespace-nowrap", TONE[card.tone])}>{card.right}</span>
      </p>
      {card.rows.length === 0 ? null : (
        <ul className="m-0 flex list-none flex-col border-t border-line p-0">
          {card.rows.map((row, position) => {
            const helper = told.helpers[position];
            const ref = helper === undefined ? undefined : refs.find((item) => item.index === helper.index);
            const body = (
              <>
                <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-medium text-ink">{row.name}</span>
                    {row.ran === "" ? null : <span className="truncate text-muted">{row.ran}</span>}
                  </span>
                  <span className="flex items-baseline gap-2 whitespace-nowrap">
                    {row.number === null ? null : <span className="text-muted">{row.number}</span>}
                    <span data-row-state className={TONE[row.tone]}>{row.right}</span>
                    {row.took === null ? null : <span className="text-faint">{row.took}</span>}
                  </span>
                </span>
                {row.model === "" ? null : <span className="block truncate text-faint">{row.model}</span>}
              </>
            );
            return (
              <li key={helper?.index ?? position} data-helper-row className="border-b border-line last:border-b-0">
                {ref === undefined ? (
                  <div className="px-3 py-1.5">{body}</div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Open ${row.name}, ${row.right}`}
                    className="block w-full cursor-pointer px-3 py-1.5 text-left -outline-offset-2 outline-clay hover:bg-slip focus-visible:outline-2"
                    onClick={() => {
                      openHelper({ callId, helperId: ref.id });
                    }}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
