import { useRef, type ReactNode } from "react";
import { cn } from "../../ui/cn.ts";

const ROW = "flex flex-col gap-1 border-t border-dashed border-line py-3 first:border-t-0";
const SEG = "inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-md border border-line-strong bg-bg p-0.5";
const SEG_BUTTON =
  "cursor-pointer rounded-sm border border-transparent px-3 py-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2 aria-checked:border-line-strong aria-checked:bg-surface aria-checked:text-ink";

/** One row of the Chat page: the label and its control on one line, the explanation below. `setting` is the word search jumps to. */
export function ChatRow({ setting, label, labelId, control, children, stacked = false }: { setting: string; label: string; labelId: string; control?: ReactNode; children: ReactNode; stacked?: boolean }) {
  return (
    <li data-setting={setting} className={ROW}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={labelId} className="text-sm font-medium text-ink">
          {label}
        </span>
        {stacked || control === undefined ? null : <span className="ml-auto flex items-center gap-3">{control}</span>}
      </div>
      <p className="text-xs text-muted">{children}</p>
      {stacked ? control : null}
    </li>
  );
}

/** A choice of a few words as one radio group. The arrows move between them and wrap round. */
export function Choice<T extends string>({ label, choices, value, onPick }: { label: string; choices: readonly { value: T; label: ReactNode; name?: string }[]; value: T; onPick: (value: T) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = (index + step + choices.length) % choices.length;
    const next = choices[at];
    if (next === undefined) return;
    onPick(next.value);
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[at]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={label} className={SEG}>
      {choices.map((choice, index) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          aria-label={choice.name}
          tabIndex={choice.value === value ? 0 : -1}
          className={SEG_BUTTON}
          onClick={() => {
            onPick(choice.value);
          }}
          onKeyDown={(event) => {
            move(event, index);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ labelledBy, checked, onToggle }: { labelledBy: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={onToggle}
      className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full outline-offset-2 outline-clay focus-visible:outline-2", checked ? "bg-clay" : "bg-line-strong")}
    >
      <span aria-hidden="true" className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform motion-reduce:transition-none", checked && "translate-x-4")} />
    </button>
  );
}

/** A part of the line under an answer: pressed means it shows. */
export function PartChip({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className="cursor-pointer rounded-full border border-line-strong bg-surface px-3 py-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2 aria-pressed:border-clay aria-pressed:bg-clay-soft aria-pressed:text-clay-ink"
    >
      {children}
    </button>
  );
}
