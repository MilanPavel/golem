import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";

/** The longest title the daemon keeps. */
export const TITLE_MAX = 60;

/** How the field ended: saved, Esc, or focus left it. A blur must not take focus back. */
export type RenameEnd = "saved" | "cancelled" | "blur";

/**
 * The title as a text field, prefilled and selected. Enter saves, Esc cancels, and so does moving
 * focus away. Empty or unchanged text saves nothing. While the save runs the field is read-only,
 * and a refused save shows its message and leaves the field open. The title the page shows
 * afterwards is the daemon's, not this text.
 */
export function RenameField({
  initial,
  label,
  onSave,
  onEnd,
  className,
}: {
  initial: string;
  label: string;
  onSave: (title: string) => Promise<void>;
  onEnd: (how: RenameEnd) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const ended = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function end(how: RenameEnd): void {
    if (ended.current) return;
    ended.current = true;
    onEnd(how);
  }

  function save(): void {
    const title = (input.current?.value ?? "").trim();
    if (title === "" || title === initial.trim()) {
      end("cancelled");
      return;
    }
    setSaving(true);
    setError(null);
    onSave(title).then(
      () => {
        end("saved");
      },
      (err: unknown) => {
        setSaving(false);
        setError(actionErrorText(err, "Could not rename the session."));
        input.current?.focus();
      },
    );
  }

  return (
    <span className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}>
      <Input
        ref={input}
        aria-label={label}
        defaultValue={initial}
        maxLength={TITLE_MAX}
        readOnly={saving}
        aria-busy={saving}
        aria-invalid={error === null ? undefined : true}
        className="px-2 py-1"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!saving) save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!saving) end("cancelled");
          }
        }}
        onBlur={() => {
          if (!saving) end("blur");
        }}
      />
      {error === null ? null : (
        <span role="alert" className="text-sm font-normal text-deny">
          {error}
        </span>
      )}
    </span>
  );
}
