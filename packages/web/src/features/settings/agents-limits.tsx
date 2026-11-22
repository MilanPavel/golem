import { limitFields, limitsChange, LIMITS_CLEAR_HINT, limitsSavedNote, SET_IN_CONFIG, type AgentRow, type LimitField, type LimitKey, type LimitTexts, type WishSetup } from "@golem/view";
import { useEffect, useId, useRef, useState } from "react";
import type { AgentLimitsChange } from "../../store/agents.ts";
import { actionErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Input } from "../../ui/input.tsx";
import { FieldError } from "./routing-parts.tsx";

/** Saves the limits of one agent type. A rejection is shown in the form and what was typed stays. */
export type SetLimits = (name: string, change: AgentLimitsChange) => Promise<void>;

/** A state to start in, for the gallery: the form open, or the form open with a refusal. */
export type LimitsDemo = "limits" | "limits-error";

/** One box of the form: its label and unit say what it is, an error sits under it. */
function LimitBox({ field, value, error, disabled, onChange }: { field: LimitField; value: string; error: string | undefined; disabled: boolean; onChange: (text: string) => void }) {
  const id = useId();
  const labelId = `${id}-label`;
  const unitId = `${id}-unit`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <label id={labelId} htmlFor={id} className="w-28 shrink-0">
          {field.label}
        </label>
        <Input
          id={id}
          value={value}
          inputMode={field.key === "max_cost" ? "decimal" : "numeric"}
          placeholder="no limit"
          disabled={disabled}
          aria-labelledby={`${labelId} ${unitId}`}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
          className="w-28 font-mono"
          onChange={(event) => onChange(event.target.value)}
        />
        <span id={unitId} className="text-muted">
          {field.unit}
        </span>
      </div>
      <FieldError id={errorId} path={field.key} errors={error === undefined ? {} : { [field.key]: error }} />
    </div>
  );
}

/** The form of the limits of one type: four boxes, Save and Cancel. */
function LimitsForm({ row, setup, onSetLimits, onDone, demo }: { row: AgentRow; setup: WishSetup; onSetLimits: SetLimits; onDone: () => void; demo: LimitsDemo | undefined }) {
  const [texts, setTexts] = useState<LimitTexts>(row.limitTexts);
  const [errors, setErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const [failure, setFailure] = useState<string | null>(demo === "limits-error" ? "The explorer may make at most 50 tool calls." : null);
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    const { change, errors: wrong, empty } = limitsChange(row.limitTexts, texts);
    setErrors(wrong);
    setFailure(null);
    if (Object.keys(wrong).length > 0) return;
    if (empty) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await onSetLimits(row.name, change);
      onDone();
    } catch (error) {
      setFailure(actionErrorText(error, `Could not save the limits of ${row.name}.`));
      setSaving(false);
    }
  };
  return (
    <form
      aria-label={`Limits of ${row.name}`}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {limitFields(setup).map((field) => (
        <LimitBox key={field.key} field={field} value={texts[field.key]} error={errors[field.key]} disabled={saving} onChange={(text) => setTexts((now) => ({ ...now, [field.key]: text }))} />
      ))}
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny wrap-anywhere">
          {failure}
        </p>
      )}
      <p className="text-meta text-muted">{LIMITS_CLEAR_HINT}</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" kind="primary" disabled={saving}>
          Save
        </Button>
        <Button size="sm" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The inside of the Limits block: the facts, with a quiet note on a value `config.toml` sets, and an Edit action that
 * opens the form. A project agent, a broken one and a page with nothing to save with only read.
 */
export function LimitsBlock({ row, setup = "mixed", onSetLimits, demo }: { row: AgentRow; setup?: WishSetup; onSetLimits: SetLimits | undefined; demo?: LimitsDemo }) {
  const [editing, setEditing] = useState(demo === "limits" || demo === "limits-error");
  const edit = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    edit.current?.focus();
  }, [editing]);
  const canEdit = row.source !== "project" && row.editable && onSetLimits !== undefined;
  if (editing && canEdit) {
    return (
      <>
        <LimitsForm
          row={row}
          setup={setup}
          onSetLimits={onSetLimits}
          demo={demo}
          onDone={() => {
            refocus.current = true;
            setEditing(false);
          }}
        />
        <p className="text-meta text-muted">{row.asksLine}</p>
      </>
    );
  }
  return (
    <>
      <dl className="grid grid-cols-3 gap-2">
        {row.limits.map((limit) => (
          <div key={limit.label}>
            <dd>
              <Code>{limit.value}</Code>
            </dd>
            <dt className="text-meta text-muted">{limit.label}</dt>
            {row.configLimits.includes(limit.label) ? <dd className="text-meta text-faint">{SET_IN_CONFIG}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="text-meta text-muted">{row.asksLine}</p>
      {row.source === "project" ? <p className="text-meta text-muted">{limitsSavedNote("project")}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button ref={edit} size="sm" aria-label="Edit limits" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <span className="text-meta text-muted">{limitsSavedNote(row.source)}</span>
        </div>
      ) : null}
    </>
  );
}
