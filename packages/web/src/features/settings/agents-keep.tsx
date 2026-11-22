import { limitFields, limitsChange, LIMITS_DEFAULT_HINT, limitTexts, type LimitField, type LimitKey, type WishSetup } from "@golem/view";
import { useId, useState } from "react";
import type { AgentsKeepValues } from "../../store/notifications.ts";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentsKeep, usePageActions } from "../../store/page-context.tsx";
import { Input } from "../../ui/input.tsx";
import { FieldError, type RoutingErrors } from "./routing-parts.tsx";

/** What a day count is when "for ever" is turned off again: the daemon's defaults. */
const DAYS_BACK = { keep_days: 7, keep_problem_days: 30 } as const;

const WHOLE_NUMBER = "Enter a whole number of days. 0 or for ever keeps them for ever.";

export type KeepKey = "keep_days" | "keep_problem_days";

/** The page's own words for what stays after the steps go. */
export const KEEP_STAYS = "What stays after: the brief, the answer, the model and the cost of each helper.";

/** One count of days: a box that saves on blur or Enter, and a "for ever" choice that writes 0. */
function KeepRow({
  label,
  field,
  value,
  errors,
  onSave,
}: {
  label: string;
  field: KeepKey;
  value: number;
  errors: RoutingErrors;
  onSave: (field: KeepKey, days: number | null) => void;
}) {
  const id = useId();
  const unitId = `${id}-unit`;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const path = `agents.${field}`;
  const forever = value === 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <label id={labelId} htmlFor={id}>
          {label}
        </label>
        <Input
          id={id}
          // A new value from the daemon replaces what is typed.
          key={value}
          defaultValue={forever ? "" : String(value)}
          inputMode="numeric"
          disabled={forever}
          placeholder="—"
          aria-labelledby={`${labelId} ${unitId}`}
          aria-invalid={errors[path] === undefined ? undefined : true}
          aria-describedby={errors[path] === undefined ? undefined : errorId}
          className="w-20 font-mono"
          onBlur={(event) => {
            const text = event.currentTarget.value.trim();
            if (text === String(value)) return;
            onSave(field, /^-?\d+$/.test(text) ? Number(text) : null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span id={unitId} className="text-muted">
          days
        </span>
        <label className="ml-2 flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={forever} onChange={(event) => onSave(field, event.target.checked ? 0 : DAYS_BACK[field])} />
          for ever
        </label>
      </div>
      <FieldError id={errorId} path={path} errors={errors} />
    </div>
  );
}

/** One limit for every helper: a box that saves on blur or Enter, with its unit. An empty box is no limit of your own. */
function DefaultLimitRow({ field, value, errors, onSave }: { field: LimitField; value: string; errors: RoutingErrors; onSave: (key: LimitKey, text: string) => void }) {
  const id = useId();
  const unitId = `${id}-unit`;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const path = `agents.${field.key}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <label id={labelId} htmlFor={id}>
          {field.label}
        </label>
        <Input
          id={id}
          // A new value from the daemon replaces what is typed.
          key={value}
          defaultValue={value}
          inputMode={field.key === "max_cost" ? "decimal" : "numeric"}
          placeholder="no limit"
          aria-labelledby={`${labelId} ${unitId}`}
          aria-invalid={errors[path] === undefined ? undefined : true}
          aria-describedby={errors[path] === undefined ? undefined : errorId}
          className="w-24 font-mono"
          onBlur={(event) => {
            const text = event.currentTarget.value.trim();
            if (text !== value) onSave(field.key, text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span id={unitId} className="text-muted">
          {field.unit}
        </span>
      </div>
      <FieldError id={errorId} path={path} errors={errors} />
    </div>
  );
}

/** The "Finished helpers" block. Apart from the hooks, so the gallery can show it. */
export function FinishedHelpers({
  values,
  errors,
  failure,
  onSave,
  setup = "mixed",
  onSaveLimit,
}: {
  values: AgentsKeepValues;
  /** The errors of the last save, by path such as `agents.keep_days`. */
  errors: RoutingErrors;
  /** A save that could not be sent at all, or null. */
  failure: string | null;
  /** Saves one count. `null` is text that is not a whole number. */
  onSave: (field: KeepKey, days: number | null) => void;
  /** Cost comes first when no local model is set up. */
  setup?: WishSetup;
  /** Saves one limit for every helper. `text` is what was typed: empty is no limit of your own. */
  onSaveLimit: (key: LimitKey, text: string) => void;
}) {
  const heading = useId();
  const limitsHeading = useId();
  const texts = limitTexts(values);
  return (
    <section data-setting="finished helpers" aria-labelledby={heading} className="flex shrink-0 flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <h3 id={heading} className="text-sm font-medium text-ink">
          Finished helpers
        </h3>
        <KeepRow label="Keep the steps for" field="keep_days" value={values.keep_days} errors={errors} onSave={onSave} />
        <KeepRow label="Keep failed, stopped and asking helpers for" field="keep_problem_days" value={values.keep_problem_days} errors={errors} onSave={onSave} />
      </div>
      <section aria-labelledby={limitsHeading} className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <h3 id={limitsHeading} className="text-sm font-medium text-ink">
          Limits for every helper
        </h3>
        {limitFields(setup).map((field) => (
          <DefaultLimitRow key={field.key} field={field} value={texts[field.key]} errors={errors} onSave={onSaveLimit} />
        ))}
      </section>
      <p className="text-xs text-faint">{LIMITS_DEFAULT_HINT}</p>
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {failure}
        </p>
      )}
      <p className="text-xs text-faint">{`How long a helper's steps stay once it is done. ${KEEP_STAYS}`}</p>
    </section>
  );
}

/** Settings › Agents, Finished helpers: reads `[agents]` and saves a change at once. */
export function FinishedHelpersSection({ setup = "mixed" }: { setup?: WishSetup }) {
  const query = useAgentsKeep();
  const actions = usePageActions();
  const [errors, setErrors] = useState<RoutingErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function save(field: KeepKey, days: number | null): Promise<void> {
    setFailure(null);
    if (days === null) {
      setErrors({ [`agents.${field}`]: WHOLE_NUMBER });
      return;
    }
    try {
      const result = await actions.setAgentsKeep({ [field]: days });
      if (result.ok) {
        setErrors({});
        return;
      }
      setErrors(Object.fromEntries((result.errors ?? []).map((error) => [error.path ?? `agents.${field}`, error.message])));
    } catch (error) {
      setFailure(actionErrorText(error, "Could not save how long the steps are kept."));
    }
  }

  async function saveLimit(key: LimitKey, text: string): Promise<void> {
    setFailure(null);
    const path = `agents.${key}`;
    const { change, errors: wrong, empty } = limitsChange(limitTexts(query.data), { ...limitTexts(query.data), [key]: text }, [key]);
    if (wrong[key] !== undefined) {
      setErrors({ [path]: wrong[key] });
      return;
    }
    if (empty) return;
    try {
      const result = await actions.setDefaultAgentLimits(change);
      if (result.ok) {
        setErrors({});
        return;
      }
      setErrors(Object.fromEntries((result.errors ?? []).map((error) => [error.path ?? path, error.message])));
    } catch (error) {
      setFailure(actionErrorText(error, "Could not save the limits for every helper."));
    }
  }

  if (query.data === undefined) {
    return query.isError ? (
      <p role="alert" className="text-sm text-deny">
        {actionErrorText(query.error, "Could not read how long the steps are kept.")}
      </p>
    ) : null;
  }
  return <FinishedHelpers values={query.data} errors={errors} failure={failure} onSave={(field, days) => void save(field, days)} setup={setup} onSaveLimit={(key, text) => void saveLimit(key, text)} />;
}
