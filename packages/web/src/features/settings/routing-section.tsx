import {
  LADDER_TIERS,
  LOCAL_ONLY_CAPTION,
  OVER_CHOICES,
  PAID_CHOICES,
  ROLES,
  ROUTE_MODES,
  parseAmount,
  parsePercent,
  pickedLine,
  toPercent,
  windowCaption,
  type RoutingChoice,
} from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import { useModelList, usePageActions, usePulls, useRouting } from "../../store/page-context.tsx";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";
import { FolderBrowser } from "../shell/folder-browser.tsx";
import { ModelPick } from "./routing-model-pick.tsx";

/** The errors of the last save, by the setting's path in `config.toml`, such as `context.clear_to`. */
export type RoutingErrors = Readonly<Record<string, string>>;

export type FolderBrowserSlot = (done: { onPick: (path: string) => void; onCancel: () => void }) => ReactNode;

function FieldError({ id, path, errors }: { id: string; path: string; errors: RoutingErrors }) {
  const message = errors[path];
  return message === undefined ? null : (
    <p id={id} role="alert" className="text-xs text-deny">
      {message}
    </p>
  );
}

function Group({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {caption === undefined ? null : <p className="text-xs text-muted">{caption}</p>}
      </div>
      {children}
    </div>
  );
}

/** One of a few choices, each with a line on what it means. Choosing one saves at once. */
function Choices<T extends string>({
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
    <fieldset className="flex flex-col gap-2" aria-describedby={errors[path] === undefined ? undefined : errorId}>
      <legend className="sr-only">{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name={name} className="mt-1" checked={value === choice.value} onChange={() => onChoose(choice.value)} />
          <span className="flex flex-col">
            <span>{choice.title}</span>
            <span className="text-xs text-muted">{choice.line}</span>
          </span>
        </label>
      ))}
      <FieldError id={errorId} path={path} errors={errors} />
    </fieldset>
  );
}

/** A number or a text in a box. It saves when the box loses focus, or on Enter, and only when it changed. */
function Box({
  label,
  path,
  value,
  errors,
  onCommit,
  prefix,
  suffix,
  hint,
  placeholder,
  disabled,
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
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const failed = errors[path] !== undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
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
          disabled={disabled}
          aria-invalid={failed ? true : undefined}
          aria-describedby={[failed ? errorId : null, hint === undefined ? null : hintId].filter((item) => item !== null).join(" ") || undefined}
          className="w-40"
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
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      <FieldError id={errorId} path={path} errors={errors} />
    </div>
  );
}

const WINDOW_NUMBER = "number";

export type RoutingViewProps = {
  values: RoutingGetResult;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  /** What Auto gives for the local model on this Mac, or null when golem has no plan to name. */
  windowNote: string | null;
  /** Saves these keys. The daemon's answer comes back as `errors` and `values`. */
  onChange: (patch: RoutingSetParams) => void;
  /** The folder browser for Add. The page passes the live one, the gallery a still one. */
  folderBrowser: FolderBrowserSlot;
};

/** Settings › Routing: every routing and context setting, each saving on its own. */
export function RoutingView({ values, listing, pulls, errors: saved, windowNote, onChange, folderBrowser }: RoutingViewProps) {
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [adding, setAdding] = useState(false);
  const [wantNumber, setWantNumber] = useState(false);
  const errors = { ...saved, ...typed };
  const { routing, ladder, roles, budget, context } = values;
  const models = useMemo(() => (listing?.models ?? []).filter((model) => model.source !== "catalog"), [listing]);
  const ofTier = (tier: ListedModel["tier"]) => models.filter((model) => model.tier === tier);

  /** Saves a typed amount: empty clears the key, a word is refused where it is typed. */
  function commit(path: string, text: string, parse: typeof parseAmount, send: (value: number | null) => RoutingSetParams): void {
    const parsed = parse(text);
    setTyped((now) => {
      const rest = Object.fromEntries(Object.entries(now).filter(([key]) => key !== path));
      return parsed.ok ? rest : { ...rest, [path]: parsed.message };
    });
    if (parsed.ok) onChange(send(parsed.value));
  }

  const windowKind = typeof context.window === "number" ? WINDOW_NUMBER : context.window;
  const windowShown = wantNumber && windowKind !== WINDOW_NUMBER ? WINDOW_NUMBER : windowKind;
  const windowChoices: readonly RoutingChoice<string>[] = [
    { value: "auto", title: "Auto (sized to memory)", line: windowNote ?? "golem plans the window from the model and this Mac's memory." },
    { value: "ollama", title: "Ollama's default", line: "golem sends no window, so Ollama picks its own." },
    { value: WINDOW_NUMBER, title: "A number", line: "Tokens, from 512 to 262144." },
  ];
  const percent = (key: "clear_at" | "clear_to" | "compact_at", label: string, hint: string) => (
    <Box
      key={key}
      label={label}
      path={`context.${key}`}
      value={toPercent(context[key])}
      suffix="%"
      hint={hint}
      errors={errors}
      onCommit={(text) => commit(`context.${key}`, text, parsePercent, (value) => ({ context: { [key]: value } }))}
    />
  );
  const count = (key: "reply_reserve" | "keep_turns" | "keep_results", label: string, hint: string) => (
    <Box
      key={key}
      label={label}
      path={`context.${key}`}
      value={String(context[key])}
      hint={hint}
      errors={errors}
      onCommit={(text) => commit(`context.${key}`, text, parseAmount, (value) => ({ context: { [key]: value } }))}
    />
  );
  const cap = (key: "daily_usd" | "session_usd", label: string) => (
    <Box
      key={key}
      label={label}
      path={`budget.${key}`}
      value={budget[key] == null ? "" : String(budget[key])}
      prefix="$"
      placeholder="No cap"
      errors={errors}
      onCommit={(text) => commit(`budget.${key}`, text, parseAmount, (value) => ({ budget: { [key]: value } }))}
    />
  );

  return (
    <div className="flex max-w-column flex-col gap-8">
      <Group title="Default route" caption="How a new chat picks its model. You can change it for one chat at any time.">
        <Choices legend="Default route" path="routing.mode" choices={ROUTE_MODES} value={routing.mode} errors={errors} onChoose={(mode) => onChange({ routing: { mode } })} />
      </Group>

      <Group title="The ladder" caption="The model golem uses in each tier. Leave a row empty and golem picks.">
        {LADDER_TIERS.map(({ tier, title, line }) => {
          const path = `routing.ladder.${tier}`;
          const errorId = `ladder-${tier}-error`;
          return (
            <div key={tier} className="flex flex-col gap-1">
              <span className="text-sm">
                {title} <span className="text-xs text-muted">{line}</span>
              </span>
              <ModelPick
                label={title}
                value={ladder[tier] ?? null}
                listing={listing}
                models={ofTier(tier)}
                pulls={pulls}
                emptyText={pickedLine(values.picked[tier] ?? null)}
                onPick={(ref) => onChange({ ladder: { [tier]: ref } })}
                describedBy={errors[path] === undefined ? undefined : errorId}
                invalid={errors[path] !== undefined}
              />
              <FieldError id={errorId} path={path} errors={errors} />
            </div>
          );
        })}
      </Group>

      <Group title="Paid models" caption="When golem asks before using a model that costs money.">
        <Choices legend="Paid models" path="routing.paid" choices={PAID_CHOICES} value={routing.paid} errors={errors} onChoose={(paid) => onChange({ routing: { paid } })} />
      </Group>

      <Group title="Caps" caption="The most golem spends on paid models, in US dollars. Empty means no cap.">
        <div className="flex flex-wrap gap-6">
          {cap("daily_usd", "Per day")}
          {cap("session_usd", "Per session")}
        </div>
        <p className="text-sm">Over a cap</p>
        <Choices legend="Over a cap" path="budget.over" choices={OVER_CHOICES} value={budget.over} errors={errors} onChoose={(over) => onChange({ budget: { over } })} />
      </Group>

      <Group title="Jobs" caption="The model for small jobs golem does by itself.">
        {ROLES.map(({ role, title, line }) => {
          const path = `routing.roles.${role}`;
          const errorId = `role-${role}-error`;
          const value = roles[role];
          return (
            <div key={role} className="flex flex-col gap-1">
              <span className="text-sm">
                {title} <span className="text-xs text-muted">{line}</span>
              </span>
              <ModelPick
                label={title}
                value={value === "session" ? null : value}
                listing={listing}
                models={models}
                pulls={pulls}
                emptyText="Same as the session"
                onPick={(ref) => onChange({ roles: { [role]: ref ?? "session" } })}
                describedBy={errors[path] === undefined ? undefined : errorId}
                invalid={errors[path] !== undefined}
              />
              <FieldError id={errorId} path={path} errors={errors} />
            </div>
          );
        })}
      </Group>

      <Group title="Local-only folders" caption={LOCAL_ONLY_CAPTION}>
        {routing.local_only.length === 0 ? (
          <p className="text-sm text-muted">No folders yet.</p>
        ) : (
          <ul aria-label="Local-only folders" className="flex flex-col gap-1">
            {routing.local_only.map((folder) => (
              <li key={folder} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-1.5 text-sm">
                <span className="min-w-0 font-mono wrap-anywhere">{folder}</span>
                <Button size="sm" aria-label={`Remove ${folder}`} onClick={() => onChange({ routing: { local_only: routing.local_only.filter((item) => item !== folder) } })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <FieldError id="local-only-error" path="routing.local_only" errors={errors} />
        {adding ? (
          <div className="rounded-lg border border-line">
            {folderBrowser({
              onPick: (path) => {
                setAdding(false);
                if (!routing.local_only.includes(path)) onChange({ routing: { local_only: [...routing.local_only, path] } });
              },
              onCancel: () => setAdding(false),
            })}
          </div>
        ) : (
          <div>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add a folder
            </Button>
          </div>
        )}
      </Group>

      <Group title="Local window" caption="How many tokens a local model reads at once.">
        <Choices
          legend="Local window"
          path="context.window"
          choices={windowChoices}
          value={windowShown}
          errors={windowShown === WINDOW_NUMBER ? {} : errors}
          onChoose={(kind) => {
            if (kind === WINDOW_NUMBER) {
              setWantNumber(true);
              return;
            }
            setWantNumber(false);
            onChange({ context: { window: kind as "auto" | "ollama" } });
          }}
        />
        {windowShown === WINDOW_NUMBER ? (
          <Box
            label="Window size"
            path="context.window"
            value={typeof context.window === "number" ? String(context.window) : ""}
            suffix="tokens"
            errors={errors}
            onCommit={(text) => commit("context.window", text, parseAmount, (value) => ({ context: { window: value } }))}
          />
        ) : null}
      </Group>

      <details className="flex flex-col gap-3">
        <summary className="cursor-pointer text-sm font-semibold">Advanced</summary>
        <div className="mt-3 flex flex-col gap-5">
          <Box
            label="Budget tier price limit"
            path="routing.budget_max_price"
            value={String(routing.budget_max_price)}
            prefix="$"
            suffix="per million tokens"
            hint="A hosted model at or below this price, blended over input and output, is in the budget tier."
            errors={errors}
            onCommit={(text) => commit("routing.budget_max_price", text, parseAmount, (value) => ({ routing: { budget_max_price: value } }))}
          />
          {count("reply_reserve", "Reply reserve", "Tokens kept free for the reply.")}
          {percent("clear_at", "Clear at", "When the history passes this share of the window, old tool results shrink to one line.")}
          {percent("clear_to", "Clear to", "Shrinking stops when the history is down to this share.")}
          {percent("compact_at", "Summarise at", "Past this share, older turns are replaced by a summary in what is sent.")}
          {count("keep_turns", "Turns kept", "The newest turns that are never summarised.")}
          {count("keep_results", "Results kept", "The newest tool results that are never shrunk.")}
          <Box
            label="Keep loaded for"
            path="context.keep_alive"
            value={context.keep_alive ?? ""}
            hint="How long Ollama keeps the model in memory after a call, such as 30m. Empty sends none."
            errors={errors}
            onCommit={(text) => onChange({ context: { keep_alive: text.trim() === "" ? null : text.trim() } })}
          />
        </div>
      </details>
    </div>
  );
}

/** Settings › Routing: reads `routing.get` and saves each change with `routing.set`. */
export function RoutingSection() {
  const routing = useRouting();
  const listing = useModelList().data ?? null;
  const pulls = usePulls();
  const actions = usePageActions();
  const [errors, setErrors] = useState<RoutingErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const local = routing.data?.picked.local ?? null;
  const options = useQuery({
    queryKey: ["model.options", local],
    queryFn: () => actions.modelOptions(local ?? "", null),
    enabled: local !== null,
    retry: false,
    staleTime: 60_000,
  });
  const note =
    options.data?.default_from?.["num_ctx"] === "golem"
      ? windowCaption(local, Number(options.data.defaults["num_ctx"] ?? Number.NaN) || null, options.data.memory?.ram_gb ?? null)
      : null;

  async function save(patch: RoutingSetParams): Promise<void> {
    setFailure(null);
    try {
      const result = await actions.setRouting(patch);
      if (result.ok) {
        setErrors({});
        return;
      }
      setErrors(Object.fromEntries((result.errors ?? []).map((error) => [error.path ?? "", error.message])));
      // An error with no setting to sit on goes where a failed save goes.
      const loose = (result.errors ?? []).find((error) => error.path == null);
      if (loose !== undefined) setFailure(loose.message);
    } catch (error) {
      setFailure(actionErrorText(error, "Could not save the setting."));
    }
  }

  if (routing.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(routing.error, "Could not read the routing settings.")}
        </p>
        <Button size="sm" onClick={() => void routing.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (routing.data === undefined) return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  return (
    <div className="flex flex-col gap-4">
      {failure === null ? null : (
        <p role="alert" className="max-w-column text-sm text-deny">
          {failure}
        </p>
      )}
      <RoutingView
        values={routing.data}
        listing={listing}
        pulls={pulls}
        errors={errors}
        windowNote={note}
        onChange={(patch) => void save(patch)}
        folderBrowser={({ onPick, onCancel }) => <FolderBrowser initialPath={null} autoFocus onPick={onPick} onCancel={onCancel} />}
      />
    </div>
  );
}
