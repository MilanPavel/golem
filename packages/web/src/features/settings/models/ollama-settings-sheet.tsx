import { useState } from "react";
import type { OllamaSettingsSetParams, OllamaSettingsSetResult, OllamaSettingsValues } from "../../../store/notifications.ts";
import { Button } from "../../../ui/button.tsx";
import { Input } from "../../../ui/input.tsx";
import { Sheet } from "./sheet.tsx";

export type OllamaSettingsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What `ollama.settings.get` gave, or null before it answered. */
  values: OllamaSettingsValues | null;
  /** Saves the keys sent. A refusal is in the result. */
  onSave: (params: OllamaSettingsSetParams) => Promise<OllamaSettingsSetResult>;
};

const MIN_PARALLEL = 1;
const MAX_PARALLEL = 8;

/** Ollama's settings: start it when needed, stop it after minutes unused, and how many requests it runs at once. */
export function OllamaSettingsSheet({ open, onOpenChange, values, onSave }: OllamaSettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ollama settings" description="How golem starts and stops Ollama on this Mac.">
      <SettingsForm values={values} onSave={onSave} onClose={() => { onOpenChange(false); }} />
    </Sheet>
  );
}

/** The form starts from what the daemon says each time the sheet opens, since the sheet mounts it then. */
function SettingsForm({ values, onSave, onClose }: { values: OllamaSettingsValues | null; onSave: OllamaSettingsSheetProps["onSave"]; onClose: () => void }) {
  const [start, setStart] = useState(values?.start ?? true);
  const [idle, setIdle] = useState(String(values?.idle_stop_minutes ?? 30));
  const [parallel, setParallel] = useState(String(values?.parallel ?? 1));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    const minutes = Number(idle);
    const count = parallel.trim().toLowerCase() === "auto" ? "auto" : Number(parallel);
    if (!Number.isInteger(minutes) || minutes < 0) {
      setError("Minutes must be a whole number, 0 or more.");
      return;
    }
    if (count !== "auto" && (!Number.isInteger(count) || count < MIN_PARALLEL || count > MAX_PARALLEL)) {
      setError(`Parallel is a whole number from ${MIN_PARALLEL} to ${MAX_PARALLEL}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onSave({ start, idle_stop_minutes: minutes, parallel: count });
      if (result.ok) onClose();
      else setError((result.errors ?? []).map((item) => item.message).join(" ") || "golem could not save these settings.");
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "" ? failure.message : "golem could not save these settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
      <form
        className="flex flex-col gap-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={start}
            onChange={(event) => {
              setStart(event.target.checked);
            }}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium">Start Ollama when a model needs it</span>
            <small className="text-meta text-faint">If you run Ollama yourself, golem uses yours and never stops it.</small>
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Stop it after this many minutes unused</span>
          <Input
            inputMode="numeric"
            value={idle}
            onChange={(event) => {
              setIdle(event.target.value);
            }}
            className="w-28"
          />
          <small className="text-meta text-faint">0 keeps it running.</small>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Parallel</span>
          <Input
            value={parallel}
            onChange={(event) => {
              setParallel(event.target.value);
            }}
            className="w-28"
          />
          <small className="text-meta text-faint">
            How many requests Ollama runs at once, 1 to 8, or auto. 2 runs two chats side by side, at about twice the memory.
          </small>
        </label>
        {values !== null && !values.started_by_golem ? (
          <p className="rounded-md bg-sunken px-3 py-2 text-muted">This Ollama was started outside golem, so it keeps its own parallel setting.</p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-deny">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" kind="primary" size="sm" disabled={saving}>
            Save
          </Button>
          <Button
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </form>
  );
}
