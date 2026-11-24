import { USE_HELPERS_POSITIONS, useHelpersPosition, type DelegateNumbers, type RulesMeasurement, type UseHelpersValue } from "@golem/view";
import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentsKeep, usePageActions } from "../../store/page-context.tsx";
import { GolemScene } from "../../ui/golem-scene.tsx";
import { showAgentsTab } from "./agents-tab.ts";
import { ReasonBlocks } from "./reason-blocks.tsx";
import { PillChoices, type RoutingErrors } from "./routing-parts.tsx";

const PATH = "agents.use_helpers";

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
    <section data-setting="use helpers" aria-labelledby={heading} className="@container flex shrink-0 flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4">
      <h3 id={heading} className="text-sm font-semibold text-ink">
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
      <div className="flex items-center gap-3">
        {position.value === "never" ? <GolemScene kind="rest" className="h-12 w-16" /> : null}
        <p className="text-meta text-muted" data-use-helpers-line="">
          {position.explain}
        </p>
      </div>
      {delegate == null ? null : <ReasonBlocks delegate={delegate} measurement={measurement} dimmed={position.value === "never"} onMeasure={onMeasure} />}
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
