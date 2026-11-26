import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { WorkflowEntryInfo } from "../../store/workflows.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { fieldClass, Input } from "../../ui/input.tsx";
import { fieldProblem, initialValues, inputFields, startInputs, type InputField } from "./run-inputs.ts";

export type RunFormProps = {
  workflow: WorkflowEntryInfo;
  /** Starts the run with these inputs. It rejects with the daemon's reason, which the form shows. It resolves once the run is open. */
  onStart: (inputs: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  /** Opens the folder dialog on the daemon's Mac, in `start` when given. Without it, a folder is typed. */
  onChooseFolder?: (start: string | null) => Promise<string | null>;
  /** The gallery shows the form on the page, outside a dialog: the title is then a plain heading. */
  inline?: boolean;
  /** The state the form opens in. For the gallery and tests; a person never sets it. */
  initial?: { values?: Record<string, string>; touched?: boolean; error?: string | null; starting?: boolean };
};

type FieldProps = {
  field: InputField;
  id: string;
  value: string;
  problem: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
  onChooseFolder?: (start: string | null) => Promise<string | null>;
};

function hintText(field: InputField): string {
  const parts = [field.typeName === "" ? "any" : field.typeName];
  parts.push(field.required ? "required" : `default ${field.default === "" ? "empty" : field.default}`);
  return parts.join(" · ");
}

function Control({ field, id, value, problem, disabled, onChange, onChooseFolder }: FieldProps) {
  const described = `${id}-hint`;
  const invalid = problem === null ? undefined : true;
  if (field.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" className="size-4 accent-clay" checked={value === "true"} disabled={disabled} aria-describedby={described} onChange={(event) => onChange(String(event.target.checked))} />
        <span className="font-medium">{field.name}</span>
      </label>
    );
  }
  const label = (
    <label htmlFor={id} className="text-sm font-medium">
      {field.name}
      {field.required ? <span className="text-deny"> *</span> : null}
    </label>
  );
  if (field.kind === "choice") {
    return (
      <>
        {label}
        <select id={id} className={fieldClass} value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={described} onChange={(event) => onChange(event.target.value)}>
          {field.required ? <option value="">Choose…</option> : null}
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </>
    );
  }
  return (
    <>
      {label}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className="font-mono"
          inputMode={field.kind === "number" ? "decimal" : undefined}
          value={value}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={described}
          placeholder={field.kind === "folder" ? "/path/to/folder" : undefined}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.kind === "folder" && onChooseFolder !== undefined ? (
          <Button
            disabled={disabled}
            aria-label={`Choose a folder for ${field.name}`}
            onClick={() => {
              onChooseFolder(value === "" ? null : value)
                .then((path) => {
                  if (path !== null) onChange(path);
                })
                .catch(() => {});
            }}
          >
            Choose…
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** The form of the Run… dialog: one field per input, from the workflow's declared inputs. */
export function RunForm({ workflow, onStart, onCancel, onChooseFolder, inline = false, initial }: RunFormProps) {
  const ids = useId();
  const fields = inputFields(workflow.inputs);
  const [values, setValues] = useState<Record<string, string>>({ ...initialValues(fields), ...initial?.values });
  const [touched, setTouched] = useState(initial?.touched ?? false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [starting, setStarting] = useState(initial?.starting ?? false);
  const problems = fields.map((field) => fieldProblem(field, values[field.name] ?? ""));

  const intro = fields.length === 0 ? "Starts one run now. This workflow takes no inputs." : "Starts one run now. The form comes from the workflow's inputs.";

  function submit(): void {
    setTouched(true);
    setError(null);
    if (problems.some((problem) => problem !== null)) return;
    setStarting(true);
    onStart(startInputs(fields, values)).catch((err: unknown) => {
      setError(actionErrorText(err, "Could not start the run."));
      setStarting(false);
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!starting) submit();
      }}
    >
      {inline ? <h2 className="text-base font-semibold">Run {workflow.name}</h2> : <DialogTitle>Run {workflow.name}</DialogTitle>}
      {inline ? <p className="mt-1 text-sm text-muted">{intro}</p> : <DialogDescription>{intro}</DialogDescription>}
      {fields.length === 0 ? null : (
        <div className="mt-4 flex flex-col gap-4">
          {fields.map((field, at) => {
            const id = `${ids}-${field.name}`;
            const problem = touched ? (problems[at] ?? null) : null;
            return (
              <div key={field.name} className="flex flex-col gap-1">
                <Control
                  field={field}
                  id={id}
                  value={values[field.name] ?? ""}
                  problem={problem}
                  disabled={starting}
                  onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
                  onChooseFolder={onChooseFolder}
                />
                <span id={`${id}-hint`} className="text-xs text-muted">
                  {hintText(field)}
                </span>
                {problem === null ? null : (
                  <span role="alert" className="text-xs text-deny">
                    {problem}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="mt-4 rounded-md border border-deny bg-deny-soft px-3 py-2 text-sm text-deny wrap-anywhere">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" type="submit" disabled={starting}>
          {starting ? "Starting…" : "Run"}
        </Button>
      </div>
    </form>
  );
}

export type RunDialogProps = Omit<RunFormProps, "initial" | "inline"> & { open: boolean };

/** The Run… dialog. "Run" opens the new run, so the dialog closes itself only when the run starts and the caller moves on. */
export function RunDialog({ open, ...form }: RunDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : form.onCancel())}>
      <DialogContent>
        <RunForm {...form} />
      </DialogContent>
    </Dialog>
  );
}
