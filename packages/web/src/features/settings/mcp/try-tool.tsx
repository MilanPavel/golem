import { ownToolName, parseJsonArguments, tryArguments, tryFields, tryInitial, type TryField } from "@golem/view";
import { useId, useMemo, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpCallResult, McpServer } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { DialogDescription, DialogTitle } from "../../../ui/dialog.tsx";
import { fieldClass, Input } from "../../../ui/input.tsx";
import { Textarea } from "../../../ui/textarea.tsx";

type Tool = { name: string; description: string; input_schema?: Record<string, unknown> | null };

/**
 * Runs one tool by hand. The form comes from the tool's input schema, and a schema it cannot draw,
 * or a person who prefers it, gets JSON. The call asks no approval and is part of no chat.
 */
export function TryTool({ server, tool, sessionId, onClose }: { server: McpServer; tool: Tool; sessionId: string | null; onClose?: () => void }) {
  const actions = usePageActions();
  const own = ownToolName(server.name, tool.name);
  const fields = useMemo(() => tryFields(tool.input_schema), [tool.input_schema]);
  const [json, setJson] = useState(fields === null);
  const [values, setValues] = useState<Record<string, string>>(() => tryInitial(fields ?? []));
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpCallResult | null>(null);
  const id = useId();

  async function run(): Promise<void> {
    let args: Record<string, unknown>;
    if (json || fields === null) {
      const parsed = parseJsonArguments(text);
      if ("error" in parsed) {
        setErrors({});
        setFailure(parsed.error);
        return;
      }
      args = parsed.arguments;
    } else {
      const made = tryArguments(fields, values);
      if ("errors" in made) {
        setErrors(made.errors);
        setFailure(null);
        return;
      }
      args = made.arguments;
    }
    setErrors({});
    setFailure(null);
    setResult(null);
    setRunning(true);
    try {
      setResult(await actions.callMcp(server.name, own, args, sessionId));
    } catch (error) {
      setFailure(actionErrorText(error, `Could not run ${own}.`));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      {onClose === undefined ? (
        <p className="text-sm text-muted">Runs now, without asking. It is not part of any chat.</p>
      ) : (
        <>
          <DialogTitle className="font-mono">Try {own}</DialogTitle>
          <DialogDescription>Runs now, without asking. It is not part of any chat.</DialogDescription>
        </>
      )}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        {json || fields === null ? (
          <label className="flex flex-col gap-1 text-sm">
            Arguments (JSON)
            <Textarea className="font-mono" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} placeholder='{"path": "/tmp"}' />
          </label>
        ) : (
          fields.map((field) => (
            <Field
              key={field.id}
              field={field}
              value={values[field.id] ?? ""}
              error={errors[field.id] ?? null}
              inputId={`${id}-${field.id}`}
              onChange={(value) => setValues((now) => ({ ...now, [field.id]: value }))}
            />
          ))
        )}
        {fields !== null && fields.length === 0 && !json ? <p className="text-sm text-muted">This tool takes no arguments.</p> : null}
        {failure === null ? null : (
          <p role="alert" className="text-sm text-deny">
            {failure}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {fields === null ? (
            <span className="text-xs text-muted">This tool's arguments are typed as JSON.</span>
          ) : (
            <Button size="sm" onClick={() => setJson((now) => !now)}>
              {json ? "Use the form" : "Use JSON"}
            </Button>
          )}
          <div className="flex gap-2">
            {onClose === undefined ? null : <Button onClick={onClose}>Close</Button>}
            <Button type="submit" kind="primary" disabled={running}>
              {running ? "Running…" : "Run"}
            </Button>
          </div>
        </div>
      </form>
      {result === null ? null : (
        <div className="mt-3 flex flex-col gap-1" role="status">
          <p className={result.is_error ? "text-sm text-deny" : "text-sm text-muted"}>{result.is_error ? "The tool reported an error:" : "Result:"}</p>
          <pre className="max-h-64 overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere">{result.text === "" ? "(no text)" : result.text}</pre>
        </div>
      )}
    </>
  );
}

function Field({ field, value, error, inputId, onChange }: { field: TryField; value: string; error: string | null; inputId: string; onChange: (value: string) => void }) {
  const hintId = `${inputId}-hint`;
  const label = `${field.id}${field.required ? " (required)" : ""}`;
  const describedBy = field.hint === null ? undefined : hintId;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {field.kind === "boolean" ? (
        <label className="flex items-center gap-2">
          <input id={inputId} type="checkbox" checked={value === "true"} aria-describedby={describedBy} onChange={(event) => onChange(event.target.checked ? "true" : "")} />
          {label}
        </label>
      ) : (
        <>
          <label htmlFor={inputId}>{label}</label>
          {field.kind === "choice" ? (
            <select id={inputId} className={fieldClass} value={value} aria-describedby={describedBy} aria-invalid={error !== null} onChange={(event) => onChange(event.target.value)}>
              <option value="">{field.required ? "Choose…" : "(none)"}</option>
              {field.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={inputId}
              value={value}
              inputMode={field.kind === "text" ? undefined : "decimal"}
              aria-describedby={describedBy}
              aria-invalid={error !== null}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </>
      )}
      {field.hint === null ? null : (
        <p id={hintId} className="text-xs text-muted">
          {field.hint}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {error}
        </p>
      )}
    </div>
  );
}
