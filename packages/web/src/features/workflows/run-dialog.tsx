import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { WorkflowEntryInfo } from "../../store/workflows.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { InputFieldList } from "./input-fields.tsx";
import { fieldProblem, initialValues, inputFields, startInputs } from "./run-inputs.ts";

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
        <InputFieldList
          className="mt-4"
          idPrefix={ids}
          fields={fields}
          values={values}
          showProblems={touched}
          disabled={starting}
          onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
          onChooseFolder={onChooseFolder}
        />
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
