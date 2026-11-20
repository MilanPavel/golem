import { OVER_CHOICES, PAID_CHOICES, ROUTING_WORDS, parseAmount, type RoutingState } from "@golem/view";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { cn } from "../../ui/cn.ts";
import { Box, CARD, Part, PillChoices, RowChoices, type RoutingErrors } from "./routing-parts.tsx";

const usd = (amount: number): string => `$${amount.toFixed(2)}`;

/** Today's spend against the day limit. The number is the one `cost.get` gives; nothing is added up here. */
function DayMeter({ spent, limit }: { spent: number; limit: number | null }) {
  if (limit === null) {
    return (
      <div>
        <div aria-hidden="true" className="my-1 border-t-2 border-dashed border-line-strong" />
        <small className="mt-1 block text-note text-faint">{`${usd(spent)} spent today · no limit`}</small>
      </div>
    );
  }
  return (
    <div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-sunken">
        <i className="block h-full rounded-full bg-clay transition-all" style={{ width: `${limit > 0 ? Math.min(100, (spent / limit) * 100) : 100}%` }} />
      </div>
      <small className="mt-1 block text-note text-faint">{`${usd(spent)} of ${usd(limit)} spent today`}</small>
    </div>
  );
}

/** Part D, the paid gate: when golem asks before it pays, and the limits that stop it. */
export function RoutingGate({
  id,
  values,
  state,
  errors,
  spentToday,
  commit,
  onChange,
}: {
  /** The id of the part, for the gate on the path to scroll to. */
  id: string;
  values: RoutingGetResult;
  state: RoutingState;
  errors: RoutingErrors;
  /** Today's spend from `cost.get`, or null while it is not known. */
  spentToday: number | null;
  commit: (path: string, text: string, parse: typeof parseAmount, send: (value: number | null) => RoutingSetParams) => void;
  onChange: (patch: RoutingSetParams) => void;
}) {
  const { budget, routing } = values;
  const words = ROUTING_WORDS.gate;
  const limit = (key: "daily_usd" | "session_usd", label: string) => (
    <Box
      label={label}
      path={`budget.${key}`}
      value={budget[key] == null ? "" : String(budget[key])}
      prefix="$"
      placeholder="No limit"
      row
      errors={errors}
      onCommit={(text) => commit(`budget.${key}`, text, parseAmount, (value) => ({ budget: { [key]: value } }))}
    />
  );
  return (
    <Part id={id} setting="paid gate" title={words.title} line={words.line}>
      <div className={cn(CARD, "grid grid-cols-1 @route:grid-cols-2", state.mode === "local" && "opacity-45")}>
        <div className="p-5">
          <h4 className="text-sm font-semibold">{words.before}</h4>
          <p className="mb-3 text-note text-muted">{words.beforeLine}</p>
          <RowChoices legend={words.before} path="routing.paid" choices={PAID_CHOICES} value={routing.paid} errors={errors} onChoose={(paid) => onChange({ routing: { paid } })} />
        </div>
        <div className={cn("border-t border-line p-5 @route:border-l @route:border-t-0", state.mode === "auto" && state.paid === "never" && "opacity-45")}>
          <h4 className="text-sm font-semibold">{words.limits}</h4>
          <p className="mb-3 text-note text-muted">{words.limitsLine}</p>
          <div className="mb-3.5 flex flex-col gap-1.5">
            {limit("daily_usd", words.day)}
            {spentToday === null ? null : <DayMeter spent={spentToday} limit={budget.daily_usd ?? null} />}
          </div>
          <div className="mb-3.5">{limit("session_usd", words.chat)}</div>
          <div className={cn("flex flex-wrap items-center gap-2 text-sm", state.daily === null && state.chat === null && "opacity-45")}>
            <span>{words.over}</span>
            <PillChoices legend={words.over} path="budget.over" choices={OVER_CHOICES} value={budget.over} errors={errors} onChoose={(over) => onChange({ budget: { over } })} />
          </div>
        </div>
      </div>
    </Part>
  );
}
