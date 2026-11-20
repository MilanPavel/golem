import type { ContextSpan, RoutingChoice, Span } from "@golem/view";
import { useId, type ReactNode } from "react";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";

/** The errors of the last save, by the setting's path in `config.toml`, such as `context.clear_to`. */
export type RoutingErrors = Readonly<Record<string, string>>;

export function FieldError({ id, path, errors }: { id: string; path: string; errors: RoutingErrors }) {
  const message = errors[path];
  return message === undefined ? null : (
    <p id={id} role="alert" className="text-xs text-deny">
      {message}
    </p>
  );
}

/** A part of the page: a heading with a line beside it, then the body. */
export function Part({ id, setting, title, tag, line, children }: { id?: string; setting?: string; title: string; tag?: ReactNode; line?: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section id={id} data-setting={setting} aria-labelledby={heading} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <h3 id={heading} className="text-base font-semibold">
          {title}
        </h3>
        {tag}
        {line === undefined ? null : <p className="text-sm text-muted">{line}</p>}
      </div>
      {children}
    </section>
  );
}

export const CARD = "rounded-lg border border-line bg-surface shadow-soft";

/** A closed disclosure for the settings the picture does not show. It opens when one of them has an error. */
export function More({ label, note, forceOpen, children }: { label: string; note?: string; forceOpen?: boolean; children: ReactNode }) {
  return (
    <details open={forceOpen === true ? true : undefined}>
      <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">
        {label}
        {note === undefined ? null : <small className="ml-2 font-normal text-faint">{`— ${note}`}</small>}
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/** Text with the chips, the money, the free and the two steps of a summary styled. */
export function Spans({ spans }: { spans: readonly (Span | ContextSpan)[] }) {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case "chip":
            return (
              <span key={index} className="whitespace-nowrap rounded-md border border-line-strong bg-slip px-1.5 py-0.5 font-mono text-xs font-medium text-ink">
                {span.text}
              </span>
            );
          case "money":
            return (
              <span key={index} className="font-semibold text-clay-ink">
                {span.text}
              </span>
            );
          case "free":
            return (
              <span key={index} className="font-semibold text-allow">
                {span.text}
              </span>
            );
          case "wait":
            return (
              <span key={index} className="font-semibold text-wait">
                {span.text}
              </span>
            );
          case "summary":
            return (
              <span key={index} className="font-semibold text-ctx-summary">
                {span.text}
              </span>
            );
          default:
            return <span key={index}>{span.text}</span>;
        }
      })}
    </>
  );
}

/** The dot of a radio that is drawn by hand. Its label is the `group`. */
function Dot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1 grid size-3.5 flex-none place-items-center rounded-full border-2 border-line-strong group-has-checked:border-clay group-has-checked:*:bg-clay",
        className,
      )}
    >
      <span className="size-2 rounded-full" />
    </span>
  );
}

const CHOSEN = "has-checked:border-clay has-checked:bg-clay-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-clay";

/** One of a few choices as cards, each with a picture. Choosing one saves at once. */
export function CardChoices<T extends string>({
  legend,
  path,
  choices,
  value,
  errors,
  onChoose,
  pictures,
}: {
  legend: string;
  path: string;
  choices: readonly RoutingChoice<T>[];
  value: T;
  errors: RoutingErrors;
  onChoose: (value: T) => void;
  pictures: Readonly<Record<T, ReactNode>>;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={errors[path] === undefined ? undefined : errorId} className="flex flex-col gap-2">
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-1 gap-3 @route:grid-cols-3">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "group grid cursor-pointer cols-route-card items-center gap-3.5 rounded-lg border-2 border-line bg-surface p-4 hover:border-line-strong",
              CHOSEN,
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={value === choice.value} onChange={() => onChoose(choice.value)} />
            <span aria-hidden="true">{pictures[choice.value]}</span>
            <span className="flex flex-col">
              <span className="flex items-center gap-2 font-semibold">
                <Dot className="mt-0" />
                {choice.title}
              </span>
              <span className="mt-0.5 text-sm text-muted">{choice.line}</span>
            </span>
          </label>
        ))}
      </div>
      <FieldError id={errorId} path={path} errors={errors} />
    </fieldset>
  );
}

/** One of a few choices as rows with a dot and a line. Choosing one saves at once. */
export function RowChoices<T extends string>({
  legend,
  path,
  choices,
  value,
  errors,
  onChoose,
}: {
  legend: string;
  path: string;
  choices: readonly RoutingChoice<T>[];
  value: T;
  errors: RoutingErrors;
  onChoose: (value: T) => void;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={errors[path] === undefined ? undefined : errorId} className="flex flex-col gap-1.5">
      <legend className="sr-only">{legend}</legend>
      {choices.map((choice) => (
        <label
          key={choice.value}
          className={cn("group grid cursor-pointer cols-route-radio gap-2.5 rounded-md border border-transparent px-3 py-2 hover:bg-bg", CHOSEN)}
        >
          <input type="radio" name={name} className="sr-only" checked={value === choice.value} onChange={() => onChoose(choice.value)} />
          <Dot />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{choice.title}</span>
            <span className="text-note text-muted">{choice.line}</span>
          </span>
        </label>
      ))}
      <FieldError id={errorId} path={path} errors={errors} />
    </fieldset>
  );
}

/** Two or three short choices in a pill. `value` null checks none. */
export function PillChoices<T extends string>({
  legend,
  path,
  choices,
  value,
  errors,
  onChoose,
}: {
  legend: string;
  path: string;
  choices: readonly { value: T; title: string }[];
  value: T | null;
  errors: RoutingErrors;
  onChoose: (value: T) => void;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={errors[path] === undefined ? undefined : errorId} className="flex flex-col gap-1">
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex self-start rounded-full border border-line-strong bg-bg p-0.5">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="cursor-pointer rounded-full px-3 py-0.5 text-note text-muted has-checked:bg-surface has-checked:font-medium has-checked:text-ink has-checked:ring-1 has-checked:ring-line-strong has-focus-visible:outline-2 has-focus-visible:outline-clay"
          >
            <input type="radio" name={name} className="sr-only" checked={value === choice.value} onChange={() => onChoose(choice.value)} />
            {choice.title}
          </label>
        ))}
      </div>
      <FieldError id={errorId} path={path} errors={errors} />
    </fieldset>
  );
}

/** A number or a text in a box. It saves when the box loses focus, or on Enter, and only when it changed. */
export function Box({
  label,
  path,
  value,
  errors,
  onCommit,
  prefix,
  suffix,
  hint,
  placeholder,
  row,
  className,
}: {
  label: string;
  path: string;
  value: string;
  errors: RoutingErrors;
  onCommit: (text: string) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  placeholder?: string;
  /** The label stands left of the box. */
  row?: boolean;
  className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const failed = errors[path] !== undefined;
  return (
    <div className={cn(row ? "grid cols-route-row items-center gap-x-3 gap-y-1" : "flex flex-col gap-1", className)}>
      <label htmlFor={id} className={cn("text-sm", row && "font-medium")}>
        {label}
      </label>
      <div className="flex items-center gap-2 text-sm text-muted">
        {prefix === undefined ? null : <span aria-hidden="true">{prefix}</span>}
        <Input
          id={id}
          // A new value from the daemon replaces what is typed.
          key={value}
          defaultValue={value}
          inputMode="decimal"
          placeholder={placeholder}
          aria-invalid={failed ? true : undefined}
          aria-describedby={[failed ? errorId : null, hint === undefined ? null : hintId].filter((item) => item !== null).join(" ") || undefined}
          className="w-36 font-mono"
          onBlur={(event) => {
            if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {suffix === undefined ? null : <span aria-hidden="true">{suffix}</span>}
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className={cn("text-xs text-muted", row && "col-span-2")}>
          {hint}
        </p>
      )}
      {failed ? (
        <div className={row ? "col-span-2" : undefined}>
          <FieldError id={errorId} path={path} errors={errors} />
        </div>
      ) : null}
    </div>
  );
}

/** A count with a minus and a plus. Each press saves at once. */
export function Stepper({
  label,
  shown,
  onLess,
  onMore,
  lessDisabled,
}: {
  label: string;
  shown: string;
  onLess: () => void;
  onMore: () => void;
  lessDisabled?: boolean;
}) {
  const button = "size-7 text-muted hover:text-ink disabled:opacity-40";
  return (
    <span role="group" aria-label={label} className="inline-flex items-center rounded-md border border-line-strong bg-bg">
      <button type="button" aria-label={`${label}: less`} disabled={lessDisabled} onClick={onLess} className={button}>
        −
      </button>
      <output aria-label={`${label}: value`} className="min-w-9 text-center font-mono text-note font-medium">
        {shown}
      </output>
      <button type="button" aria-label={`${label}: more`} onClick={onMore} className={button}>
        +
      </button>
    </span>
  );
}
