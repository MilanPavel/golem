import { USE_HELPERS_POSITIONS, reasonTiles, rulesFoot, useHelpersExplain, useHelpersPosition, type DelegateNumbers, type RulesMeasurement, type UseHelpersValue } from "@golem/view";
import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentsKeep, usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { showAgentsTab } from "./agents-tab.ts";
import { PillChoices, type RoutingErrors } from "./routing-parts.tsx";

const PATH = "agents.use_helpers";

/** The three reasons "When needed" lists, with the four numbers, and the line that says where the numbers come from. Dimmed, not hidden, when helpers are never used. */
export function ReasonTiles({ delegate, measurement = null, dimmed, onMeasure }: { delegate: DelegateNumbers; measurement?: RulesMeasurement | null; dimmed: boolean; onMeasure: () => void }) {
  const foot = rulesFoot(delegate, measurement);
  return (
    <div data-reasons="" data-dimmed={dimmed ? "" : undefined} className="flex flex-col gap-3">
      <div className={cn("grid gap-2 sm:grid-cols-3", dimmed && "opacity-50")}>
        {reasonTiles(delegate).map((tile) => (
          <div key={tile.key} data-reason={tile.key} className="flex flex-col gap-1 rounded-md border border-line bg-bg px-3 py-2">
            <h4 className="text-xs font-medium text-ink">{tile.title}</h4>
            <p className="text-sm text-muted">
              {tile.line.map((part, index) =>
                part.number === true ? (
                  <span key={index} data-number="" data-changed={part.changed === true ? "" : undefined} className={cn("font-medium text-ink", part.changed === true && "text-clay")}>
                    {part.text}
                  </span>
                ) : (
                  part.text
                ),
              )}
            </p>
            <small className="text-xs text-faint">{tile.note}</small>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-xs text-muted" data-reasons-foot="">
        <span>
          <span className="font-medium text-faint">{foot.tag}</span> {foot.text}
        </span>
        <Button size="sm" className="ml-auto" onClick={onMeasure}>
          {foot.kind === "measured" ? "Measure again" : "Measure on this Mac"}
        </Button>
      </div>
    </div>
  );
}

/** The "Use helpers" block: three positions and the line for the chosen one. Apart from the hooks, so the gallery can show it. */
export function UseHelpers({
  value,
  errors = {},
  failure = null,
  onChoose,
  delegate,
  measurement,
  onMeasure = () => showAgentsTab("measure"),
}: {
  value: UseHelpersValue | undefined;
  /** The errors of the last save, by path such as `agents.use_helpers`. */
  errors?: RoutingErrors;
  /** A save that could not be sent at all, or null. */
  failure?: string | null;
  onChoose: (value: UseHelpersValue) => void;
  /** The four numbers behind "When needed"; the tiles show only when the daemon sent them. */
  delegate?: DelegateNumbers | null;
  /** The measurement whose numbers are in use, when known. */
  measurement?: RulesMeasurement | null;
  onMeasure?: () => void;
}) {
  const heading = useId();
  const position = useHelpersPosition(value);
  return (
    <section data-setting="use helpers" aria-labelledby={heading} className="flex shrink-0 flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h3 id={heading} className="text-sm font-medium text-ink">
          Use helpers
        </h3>
        <PillChoices
          legend="Use helpers"
          path={PATH}
          choices={USE_HELPERS_POSITIONS.map((each) => ({ value: each.value, title: each.label }))}
          value={position.value}
          errors={errors}
          onChoose={onChoose}
        />
      </div>
      <p className="rounded-md bg-sunken px-3 py-2 text-sm text-muted" data-use-helpers-line="">
        {useHelpersExplain(position.value)}
      </p>
      {delegate == null ? null : <ReasonTiles delegate={delegate} measurement={measurement} dimmed={position.value === "never"} onMeasure={onMeasure} />}
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {failure}
        </p>
      )}
    </section>
  );
}

/** Settings › Agents, Use helpers: reads `[agents] use_helpers` and saves a change at once. */
export function UseHelpersSection({ measurement = null }: { measurement?: RulesMeasurement | null }) {
  const query = useAgentsKeep();
  const actions = usePageActions();
  const [errors, setErrors] = useState<RoutingErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function save(value: UseHelpersValue): Promise<void> {
    setFailure(null);
    try {
      const result = await actions.setAgentsKeep({ use_helpers: value });
      if (result.ok) {
        setErrors({});
        return;
      }
      setErrors(Object.fromEntries((result.errors ?? []).map((error) => [error.path ?? PATH, error.message])));
    } catch (error) {
      setFailure(actionErrorText(error, "Could not save when helpers are used."));
    }
  }

  if (query.data === undefined) {
    return query.isError ? (
      <p role="alert" className="text-sm text-deny">
        {actionErrorText(query.error, "Could not read when helpers are used.")}
      </p>
    ) : null;
  }
  return <UseHelpers value={query.data.use_helpers} errors={errors} failure={failure} onChoose={(value) => void save(value)} delegate={query.data.delegate} measurement={measurement} />;
}
