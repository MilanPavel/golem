import { limitFields, limitsChange, LIMITS_DEFAULT_HINT, limitTexts, type LimitField, type LimitKey, type WishSetup } from "@golem/view";
import { useId, useState } from "react";
import type { AgentsKeepValues } from "../../store/notifications.ts";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentsKeep, usePageActions } from "../../store/page-context.tsx";
import { FieldError, type RoutingErrors } from "./routing-parts.tsx";
import { UnitField } from "./unit-field.tsx";

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
    <div className="flex flex-col gap-1.5">
      <label id={labelId} htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <UnitField
        id={id}
        // A new value from the daemon replaces what is typed.
        key={value}
        defaultValue={forever ? "" : String(value)}
        inputMode="numeric"
        disabled={forever}
        placeholder="—"
        unit="days"
        unitId={unitId}
        invalid={errors[path] !== undefined}
        aria-labelledby={`${labelId} ${unitId}`}
        aria-describedby={errors[path] === undefined ? undefined : errorId}
        onBlur={(event) => {
          const text = event.currentTarget.value.trim();
          if (text === String(value)) return;
          onSave(field, /^-?\d+$/.test(text) ? Number(text) : null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <label className="flex items-center gap-1.5 text-sm text-muted">
        <input type="checkbox" checked={forever} onChange={(event) => onSave(field, event.target.checked ? 0 : DAYS_BACK[field])} />
        for ever
      </label>
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
    <div className="flex flex-col gap-1.5">
      <label id={labelId} htmlFor={id} className="text-sm font-medium text-ink">
        {field.label}
      </label>
      <UnitField
        id={id}
        // A new value from the daemon replaces what is typed.
        key={value}
        defaultValue={value}
        inputMode={field.key === "max_cost" ? "decimal" : "numeric"}
        placeholder="no limit"
        unit={field.unit}
        unitId={unitId}
        invalid={errors[path] !== undefined}
        aria-labelledby={`${labelId} ${unitId}`}
        aria-describedby={errors[path] === undefined ? undefined : errorId}
        onBlur={(event) => {
          const text = event.currentTarget.value.trim();
          if (text !== value) onSave(field.key, text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <FieldError id={errorId} path={path} errors={errors} />
    </div>
  );
}

/** The "Limits for every helper" block: what a helper may spend when its agent sets no limit of its own. Apart from the hooks, so the gallery can show it. */
export function DefaultLimits({
  values,
  errors,
  failure,
  setup = "mixed",
  onSaveLimit,
}: {
  values: AgentsKeepValues;
  /** The errors of the last save, by path such as `agents.max_calls`. */
  errors: RoutingErrors;
  /** A save that could not be sent at all, or null. */
  failure: string | null;
  /** Cost comes first when no local model is set up. */
  setup?: WishSetup;
  /** Saves one limit for every helper. `text` is what was typed: empty is no limit of your own. */
  onSaveLimit: (key: LimitKey, text: string) => void;
}) {
  const heading = useId();
  const texts = limitTexts(values);
  return (
    <section data-setting="limits for every helper" aria-labelledby={heading} className="@container flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4">
      <h3 id={heading} className="text-sm font-semibold text-ink">
        Limits for every helper
      </h3>
      <p className="text-meta text-muted">{LIMITS_DEFAULT_HINT}</p>
      <div className="grid grid-cols-1 gap-x-3.5 gap-y-3 @sm:grid-cols-2">
        {limitFields(setup).map((field) => (
          <DefaultLimitRow key={field.key} field={field} value={texts[field.key]} errors={errors} onSave={onSaveLimit} />
        ))}
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {failure}
        </p>
      )}
    </section>
  );
}

/** The "Finished helpers" block. Apart from the hooks, so the gallery can show it. */
export function FinishedHelpers({
  values,
  errors,
  failure,
  onSave,
}: {
  values: AgentsKeepValues;
  /** The errors of the last save, by path such as `agents.keep_days`. */
  errors: RoutingErrors;
  /** A save that could not be sent at all, or null. */
  failure: string | null;
  /** Saves one count. `null` is text that is not a whole number. */
  onSave: (field: KeepKey, days: number | null) => void;
}) {
  const heading = useId();
  return (
    <section data-setting="finished helpers" aria-labelledby={heading} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4">
      <h3 id={heading} className="text-sm font-semibold text-ink">
        Finished helpers
      </h3>
      <p className="text-meta text-muted">{`How long a helper's steps stay once it is done. ${KEEP_STAYS}`}</p>
      <div className="flex flex-col gap-3">
        <KeepRow label="Keep the steps for" field="keep_days" value={values.keep_days} errors={errors} onSave={onSave} />
        <KeepRow label="Keep failed, stopped and asking helpers for" field="keep_problem_days" value={values.keep_problem_days} errors={errors} onSave={onSave} />
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {failure}
        </p>
      )}
    </section>
  );
}

/** What a block shows while its values are not read yet: nothing, or the error of the read. */
function KeepUnread({ query, text }: { query: ReturnType<typeof useAgentsKeep>; text: string }) {
  return query.isError ? (
    <p role="alert" className="text-sm text-deny">
      {actionErrorText(query.error, text)}
    </p>
  ) : null;
}

/** Settings › Agents › Rules, Limits for every helper: reads `[agents]` and saves a change at once. */
export function DefaultLimitsSection({ setup = "mixed" }: { setup?: WishSetup }) {
  const query = useAgentsKeep();
  const actions = usePageActions();
  const [errors, setErrors] = useState<RoutingErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

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

  if (query.data === undefined) return <KeepUnread query={query} text="Could not read the limits for every helper." />;
  return <DefaultLimits values={query.data} errors={errors} failure={failure} setup={setup} onSaveLimit={(key, text) => void saveLimit(key, text)} />;
}

/** Settings › Agents › Rules, Finished helpers: reads `[agents]` and saves a change at once. */
export function FinishedHelpersSection() {
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

  if (query.data === undefined) return <KeepUnread query={query} text="Could not read how long the steps are kept." />;
  return <FinishedHelpers values={query.data} errors={errors} failure={failure} onSave={(field, days) => void save(field, days)} />;
}
