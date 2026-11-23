import { USE_HELPERS_POSITIONS, useHelpersExplain, useHelpersPosition, type UseHelpersValue } from "@golem/view";
import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentsKeep, usePageActions } from "../../store/page-context.tsx";
import { PillChoices, type RoutingErrors } from "./routing-parts.tsx";

const PATH = "agents.use_helpers";

/** The "Use helpers" block: three positions and the line for the chosen one. Apart from the hooks, so the gallery can show it. */
export function UseHelpers({
  value,
  errors = {},
  failure = null,
  onChoose,
}: {
  value: UseHelpersValue | undefined;
  /** The errors of the last save, by path such as `agents.use_helpers`. */
  errors?: RoutingErrors;
  /** A save that could not be sent at all, or null. */
  failure?: string | null;
  onChoose: (value: UseHelpersValue) => void;
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
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {failure}
        </p>
      )}
    </section>
  );
}

/** Settings › Agents, Use helpers: reads `[agents] use_helpers` and saves a change at once. */
export function UseHelpersSection() {
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
  return <UseHelpers value={query.data.use_helpers} errors={errors} failure={failure} onChoose={(value) => void save(value)} />;
}
