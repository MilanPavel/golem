import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { fieldClass, Input } from "../../ui/input.tsx";
import { fieldProblem, type InputField } from "./run-inputs.ts";

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

export type InputFieldListProps = {
  fields: readonly InputField[];
  values: Readonly<Record<string, string>>;
  /** A prefix that keeps the ids of two lists on one page apart. */
  idPrefix: string;
  /** Show each field's complaint (a required one left empty, a number that is not one). */
  showProblems: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (name: string, value: string) => void;
  /** Opens the folder dialog on the daemon's Mac, in `start` when given. Without it, a folder is typed. */
  onChooseFolder?: (start: string | null) => Promise<string | null>;
};

/** One field for each declared input of a workflow: the Run… dialog and the routine editor show the same ones. */
export function InputFieldList({ fields, values, idPrefix, showProblems, disabled = false, className, onChange, onChooseFolder }: InputFieldListProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const problem = showProblems ? fieldProblem(field, values[field.name] ?? "") : null;
        return (
          <div key={field.name} className="flex flex-col gap-1">
            <Control field={field} id={id} value={values[field.name] ?? ""} problem={problem} disabled={disabled} onChange={(value) => onChange(field.name, value)} onChooseFolder={onChooseFolder} />
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
  );
}
