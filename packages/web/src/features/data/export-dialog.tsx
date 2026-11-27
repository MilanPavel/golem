import { useId, useState } from "react";
import {
  defaultExportPath,
  EXPORT_BUTTON,
  EXPORT_EXCEL_NOTE,
  EXPORT_FORMATS,
  EXPORT_NEW_FILE_NOTE,
  EXPORT_TITLE,
  exportCutText,
  exportedText,
  exportHeading,
  formatOfPath,
  withFormat,
  type DataExtensionName,
  type ExportFormat,
} from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Input } from "../../ui/input.tsx";
import { dataErrorText, type DataExportParams, type DataExportResult } from "../../store/data.ts";
import { ExtensionRow } from "./extension-row.tsx";

/** The state a form can open in. For the gallery and tests; a person never sets it. */
export type ExportFormInitial = { format?: ExportFormat; path?: string; needsExtension?: boolean; error?: string | null; done?: DataExportResult };

export type ExportFormProps = {
  resultId: string;
  source: string;
  rows: number;
  /** Writes the file. Resolves with `needs_extension` when the Excel add-on is not here. Rejects with the daemon's reason. */
  onExport: (params: DataExportParams) => Promise<DataExportResult>;
  /** Downloads an add-on. Without it the form only says the add-on is missing. */
  onInstallExtension?: (name: DataExtensionName) => Promise<void>;
  onClose: () => void;
  /** The result was cut by the row cap: `rows` of this many go into the file. Null when the whole count is not known. */
  cut?: { all: number | null };
  /** Today, for the name the form starts with. */
  today?: Date;
  /** The gallery shows the form on the page, outside a dialog: the title is then a plain heading. */
  inline?: boolean;
  initial?: ExportFormInitial;
};

/** Export a result: its format, and the new file it goes to. Nothing is written until Export is pressed. */
export function ExportForm({ resultId, source, rows, onExport, onInstallExtension, onClose, cut, today, inline = false, initial }: ExportFormProps) {
  const ids = useId();
  const start = today ?? new Date();
  const first = initial?.format ?? "csv";
  const [format, setFormat] = useState<ExportFormat>(first);
  const [path, setPath] = useState(initial?.path ?? defaultExportPath(source, start, first));
  const [typed, setTyped] = useState(initial?.path !== undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [needsExcel, setNeedsExcel] = useState(initial?.needsExtension ?? false);
  const [done, setDone] = useState<DataExportResult | null>(initial?.done ?? null);

  function pickFormat(next: ExportFormat): void {
    setFormat(next);
    setNeedsExcel(false);
    setPath((current) => (typed ? withFormat(current, next) : defaultExportPath(source, start, next)));
  }

  function write(): void {
    const target = path.trim();
    if (target === "") {
      setError("Type where to write the file first.");
      return;
    }
    setError(null);
    setBusy(true);
    // A name that ends in another format wins over the picker, so the file is what its name says.
    const chosen = formatOfPath(target) ?? format;
    onExport({ result_id: resultId, path: target, format: chosen }).then(
      (answer) => {
        setBusy(false);
        if (answer.needs_extension !== undefined && answer.needs_extension !== null) setNeedsExcel(true);
        else setDone(answer);
      },
      (failed: unknown) => {
        setBusy(false);
        setError(dataErrorText(failed, "Could not write the file."));
      },
    );
  }

  const title = inline ? <h2 className="text-base font-semibold">{EXPORT_TITLE}</h2> : <DialogTitle>{EXPORT_TITLE}</DialogTitle>;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && done === null) write();
      }}
    >
      <div className="flex flex-col gap-1">
        {title}
        {inline ? null : <DialogDescription>{EXPORT_NEW_FILE_NOTE}</DialogDescription>}
        <p className="text-sm text-muted">{exportHeading(rows, source)}</p>
        {cut === undefined ? null : <p className="text-sm text-muted">{exportCutText(rows, cut.all)}</p>}
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <label htmlFor={`${ids}-format`} className="w-16 shrink-0 pt-2 text-sm text-faint">
            Format
          </label>
          <select
            id={`${ids}-format`}
            value={format}
            disabled={busy || done !== null}
            onChange={(event) => pickFormat(event.target.value as ExportFormat)}
            className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-offset-2 outline-clay focus-visible:outline-2"
          >
            {EXPORT_FORMATS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-start gap-3">
          <label htmlFor={`${ids}-path`} className="w-16 shrink-0 pt-2 text-sm text-faint">
            Path
          </label>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              id={`${ids}-path`}
              value={path}
              readOnly={busy || done !== null}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby={`${ids}-note`}
              aria-invalid={error === null ? undefined : true}
              onChange={(event) => {
                setTyped(true);
                setPath(event.target.value);
              }}
            />
            <p id={`${ids}-note`} className="text-meta text-muted">
              {inline ? EXPORT_NEW_FILE_NOTE : "A new file. ~ is your home folder."}
            </p>
          </div>
        </div>
        {needsExcel ? <ExtensionRow name="excel" note={EXPORT_EXCEL_NOTE} onInstall={onInstallExtension ?? (() => Promise.reject(new Error("Open the Data screen to get it.")))} onDone={() => setNeedsExcel(false)} /> : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny wrap-anywhere">
            {error}
          </p>
        )}
        {done === null ? null : (
          <p role="status" className="text-sm wrap-anywhere">
            <span aria-hidden="true" className="text-allow">
              ✓{" "}
            </span>
            {exportedText(done.rows, done.path)}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" onClick={onClose}>
          {done === null ? "Cancel" : "Close"}
        </Button>
        {done === null ? (
          <Button kind="primary" type="submit" disabled={busy || needsExcel}>
            {busy ? "Writing…" : EXPORT_BUTTON}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export type ExportDialogProps = Omit<ExportFormProps, "initial" | "inline"> & { open: boolean };

/** The Export dialog. It forgets what was typed when it closes. */
export function ExportDialog({ open, ...form }: ExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : form.onClose())}>
      <DialogContent className="max-w-lg">
        <ExportForm {...form} />
      </DialogContent>
    </Dialog>
  );
}
