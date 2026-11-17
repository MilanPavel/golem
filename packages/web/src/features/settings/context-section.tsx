import {
  CHART_LEGEND,
  CONTEXT_WORDS,
  contextChart,
  hostedNote,
  localSize,
  localWindowLine,
  namesModel,
  parseAmount,
  parsePercent,
  roomExample,
  shortModel,
  stageLabels,
  toPercent,
  windowBar,
  windowSize,
  NO_LOCAL_WINDOW,
  type LocalWindow,
} from "@golem/view";
import { useMemo, useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ModelListResult } from "../../store/models.ts";
import { useModelList, useRouting } from "../../store/page-context.tsx";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { WindowBarView } from "./context-bar.tsx";
import { HEAD, ShareSlider, Stage } from "./context-controls.tsx";
import { ContextRightNow } from "./context-right-now.tsx";
import { Saw } from "./context-saw.tsx";
import { WindowTable, useWindowRows, type WindowRow } from "./context-window-table.tsx";
import { usableModels, windowKind } from "./routing-derive.ts";
import { Box, CARD, FieldError, More, Part, PillChoices, Stepper, type RoutingErrors } from "./routing-parts.tsx";
import { useLocalWindow } from "./use-local-window.ts";
import { useRoutingSave } from "./use-routing-save.ts";

export type ContextViewProps = {
  values: RoutingGetResult;
  listing: ModelListResult | null;
  errors: RoutingErrors;
  /** The window the local model gets, and where it comes from. */
  window?: LocalWindow;
  /** The local models on this Mac and the window each gets. Empty: no table. */
  models?: readonly WindowRow[];
  /** Saves these keys. The daemon's answer comes back as `errors` and `values`. */
  onChange: (patch: RoutingSetParams) => void;
};

type Context = RoutingGetResult["context"];
type Commit = (path: string, text: string, parse: typeof parseAmount, send: (value: number | null) => RoutingSetParams) => void;

/** A small label that says which models a setting reaches. */
function ScopeTag({ tone, children }: { tone: "local" | "all"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "self-start rounded-xs px-1.5 py-1 font-mono text-micro font-semibold tracking-wider whitespace-nowrap uppercase sm:self-center",
        tone === "local" ? "bg-allow-soft text-allow" : "bg-clay-soft text-clay-ink",
      )}
    >
      {children}
    </span>
  );
}

/** The error of a slider. The same error is an alert at its box under Exact numbers, so this one is only text. */
function SliderError({ id, message }: { id: string; message: string | undefined }) {
  return message === undefined ? null : (
    <p id={id} className="text-xs text-deny">
      {message}
    </p>
  );
}

/** Window size: Auto, Fixed or Ollama's. Only a model on this Mac reads it. */
function WindowSize({
  context,
  window,
  errors,
  commit,
  onChange,
  models,
}: {
  models: readonly WindowRow[];
  context: Context;
  window: LocalWindow;
  errors: RoutingErrors;
  commit: Commit;
  onChange: (patch: RoutingSetParams) => void;
}) {
  const [wantNumber, setWantNumber] = useState(false);
  const words = CONTEXT_WORDS.window;
  const kind = wantNumber ? "fixed" : windowKind(context);
  const fixed = kind === "fixed";
  return (
    <Part title={words.title} tag={<ScopeTag tone="local">{words.scope}</ScopeTag>} line={words.line}>
      <div className={cn(CARD, "grid grid-cols-1 items-start gap-x-7 gap-y-4 p-5", models.length > 0 && "@route:cols-route-long")}>
        <div className="flex flex-col gap-2">
          <PillChoices
            legend={words.title}
            path={fixed ? "context.window.pill" : "context.window"}
            choices={[
              { value: "auto", title: words.choices.auto },
              { value: "fixed", title: words.choices.fixed },
              { value: "ollama", title: words.choices.ollama },
            ]}
            value={kind}
            errors={errors}
            onChoose={(choice) => {
              setWantNumber(choice === "fixed");
              if (choice !== "fixed") onChange({ context: { window: choice } });
            }}
          />
          {fixed ? (
            <>
              <Box
                label={words.title}
                path="context.window"
                value={typeof context.window === "number" ? String(context.window) : ""}
                suffix="tokens"
                hint={words.captions.fixed}
                errors={errors}
                onCommit={(text) => commit("context.window", text, parseAmount, (value) => ({ context: { window: value } }))}
              />
              <p className="max-w-prose rounded-sm bg-wait-soft px-3 py-2 text-note text-wait">{words.fixedWarning}</p>
            </>
          ) : (
            <WindowSource kind={kind} window={window} />
          )}
          <p className="text-note text-muted">{words.chipWins}</p>
        </div>
        {models.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <WindowTable rows={models} />
            <p className="text-note text-muted">A model's own setting in its model chip wins over this choice.</p>
          </div>
        )}
      </div>
    </Part>
  );
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** Under the window choice: the window the model gets, where it comes from, and why golem has no plan. */
function WindowSource({ kind, window }: { kind: "auto" | "fixed" | "ollama"; window: LocalWindow }) {
  const line = localWindowLine(window);
  return (
    <div className="flex flex-col gap-1 text-note text-muted">
      {kind === "ollama" ? <p>{CONTEXT_WORDS.window.captions.ollama}</p> : <p>golem plans the window from the model and this Mac's memory.</p>}
      {line === null ? null : <p className="font-mono">{line}</p>}
      {window.reason === null || kind !== "auto" ? null : <p>{`${sentence(window.reason)}.`}</p>}
      {window.tokens === null ? <p>{CONTEXT_WORDS.windowAfterChat}</p> : null}
    </div>
  );
}

/** The line under the bar: this page holds rules, not a live view. `ctx` is set in code. */
function RulesLine() {
  const [before = "", code = "", after = ""] = CONTEXT_WORDS.rules.split("`");
  return (
    <p className="text-note text-muted">
      {before}
      <code className="font-mono text-ink-soft">{code}</code>
      {after}
    </p>
  );
}

type Hosted = { model: string; tokens: number; provider: string };

/** The first of the Budget and Frontier models that is listed with a known window. */
function hostedModel(values: RoutingGetResult, listing: ModelListResult | null): Hosted | null {
  for (const ref of [values.picked.budget, values.picked.frontier]) {
    if (ref == null) continue;
    const model = usableModels(listing).find((item) => namesModel(item, ref));
    if (model?.ctx != null) return { model: shortModel(ref), tokens: model.ctx, provider: model.provider };
  }
  return null;
}

/** Settings › Context: the window size, and where clearing and summarising start. */
export function ContextView({ values, listing, errors: saved, window = NO_LOCAL_WINDOW, models = [], onChange }: ContextViewProps) {
  const { context } = values;
  const words = CONTEXT_WORDS;
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [showOn, setShowOn] = useState<"local" | "hosted">("local");
  const errors = { ...saved, ...typed };
  const kind = windowKind(context);
  const localName = values.picked.local == null ? null : shortModel(values.picked.local);
  const localTokens = window.tokens;
  const hosted = useMemo(() => hostedModel(values, listing), [values, listing]);
  const onHosted = hosted !== null && (showOn === "hosted" || localName === null);
  const tokens = onHosted ? hosted.tokens : localTokens;
  const bar = windowBar(context, tokens);
  const chart = contextChart(context, tokens);
  const stages = stageLabels(context);
  const compactMin = Math.min(95, Math.max(75, Math.ceil((Math.round(context.clear_at * 100) + 5) / 5) * 5));

  /** Saves a typed amount: empty clears the key, a word is refused where it is typed. */
  const commit: Commit = (path, text, parse, send) => {
    const parsed = parse(text);
    setTyped((now) => {
      const rest = Object.fromEntries(Object.entries(now).filter(([key]) => key !== path));
      return parsed.ok ? rest : { ...rest, [path]: parsed.message };
    });
    if (parsed.ok) onChange(send(parsed.value));
  };
  const step = (key: "keep_results" | "keep_turns", by: number, min: number) => onChange({ context: { [key]: Math.max(min, context[key] + by) } });
  const percent = (key: "clear_at" | "clear_to" | "compact_at", label: string, hint: string) => (
    <Box
      label={label}
      path={`context.${key}`}
      value={toPercent(context[key])}
      suffix="%"
      hint={hint}
      errors={errors}
      onCommit={(text) => commit(`context.${key}`, text, parsePercent, (value) => ({ context: { [key]: value } }))}
    />
  );
  const exactFailed = ["clear_at", "clear_to", "compact_at", "reply_reserve", "keep_alive"].some((key) => errors[`context.${key}`] !== undefined);

  return (
    <div className="@container flex max-w-6xl flex-col gap-9">
      <p className="-mt-1 max-w-prose text-muted">{words.lead}</p>
      <ContextRightNow
        input={{
          context,
          mode: values.routing.mode,
          local: localName === null ? null : { model: localName, kind, ...window },
          hosted,
        }}
      />
      <WindowSize context={context} window={window} errors={errors} commit={commit} onChange={onChange} models={models} />
      <Part title={words.fill.title} tag={<ScopeTag tone="all">{words.fill.scope}</ScopeTag>} line={words.fill.line}>
        <div className={cn(CARD, "flex flex-col gap-4 p-5")}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-note text-muted">
            {hosted !== null && localName !== null ? (
              <>
                <span>{words.fill.showOn}</span>
                <PillChoices
                  legend={words.fill.showOn}
                  path="context.show_on"
                  choices={[
                    { value: "local", title: `${localName}${localTokens === null ? "" : ` · ${localSize(localTokens, window.estimated)}`}` },
                    { value: "hosted", title: `${hosted.model} · ${windowSize(hosted.tokens)}` },
                  ]}
                  value={onHosted ? "hosted" : "local"}
                  errors={errors}
                  onChoose={setShowOn}
                />
              </>
            ) : null}
            {hosted === null ? null : <span className="min-w-60 flex-1">{onHosted ? hostedNote(hosted.provider, hosted.tokens, context) : words.fill.same}</span>}
          </div>
          {bar === null ? (
            <p className="rounded-md border border-line bg-bg p-4 text-sm text-muted">{words.noWindow}</p>
          ) : (
            <WindowBarView bar={bar} window={tokens} reserve={context.reply_reserve} estimated={!onHosted && window.estimated} />
          )}
          <RulesLine />
          <div className="grid grid-cols-1 gap-6 border-t border-line pt-5 @route:grid-cols-3">
            <Stage when={stages.one} tone="wait">
              <b className="text-sm font-semibold">{words.clear}</b>
              <p className="mt-1 text-note leading-normal text-muted">{words.clearLine}</p>
              <ShareSlider
                share={context.clear_at}
                min={50}
                max={80}
                label="Start clearing at"
                errorId="clear-at-error"
                error={errors["context.clear_at"]}
                onSave={(share) => onChange({ context: { clear_at: share } })}
              />
              <SliderError id="clear-at-error" message={errors["context.clear_at"]} />
              <div className={cn(HEAD, "mt-2.5 text-sm")}>
                <span>{words.keepResults}</span>
                <Stepper
                  label={words.keepResults}
                  shown={String(context.keep_results)}
                  lessDisabled={context.keep_results <= 0}
                  onLess={() => step("keep_results", -1, 0)}
                  onMore={() => step("keep_results", 1, 0)}
                />
              </div>
              <FieldError id="keep-results-error" path="context.keep_results" errors={errors} />
            </Stage>
            <Stage when={stages.two} tone="summary">
              <b className="text-sm font-semibold">{words.summarise}</b>
              <p className="mt-1 text-note leading-normal text-muted">{words.summariseLine}</p>
              <ShareSlider
                share={context.compact_at}
                min={compactMin}
                max={95}
                label="Start summarising at"
                errorId="compact-at-error"
                error={errors["context.compact_at"]}
                onSave={(share) => {
                  // Step 2 never starts before step 1 does.
                  if (share > context.clear_at) onChange({ context: { compact_at: share } });
                }}
              />
              <SliderError id="compact-at-error" message={errors["context.compact_at"]} />
              <div className={cn(HEAD, "mt-2.5 text-sm")}>
                <span>{words.keepTurns}</span>
                <Stepper
                  label={words.keepTurns}
                  shown={String(context.keep_turns)}
                  lessDisabled={context.keep_turns <= 1}
                  onLess={() => step("keep_turns", -1, 1)}
                  onMore={() => step("keep_turns", 1, 1)}
                />
              </div>
              <FieldError id="keep-turns-error" path="context.keep_turns" errors={errors} />
            </Stage>
            <Stage when={stages.always}>
              <div className={HEAD}>
                <b className="text-sm font-semibold">{words.reply}</b>
                <Stepper
                  label={words.reply}
                  shown={windowSize(context.reply_reserve)}
                  lessDisabled={context.reply_reserve <= 0}
                  onLess={() => onChange({ context: { reply_reserve: Math.max(0, context.reply_reserve - 1024) } })}
                  onMore={() => onChange({ context: { reply_reserve: context.reply_reserve + 1024 } })}
                />
              </div>
              <p className="mt-1 text-note leading-normal text-muted">{roomExample(tokens, context.reply_reserve)}</p>
              <FieldError id="reply-reserve-error" path="context.reply_reserve" errors={errors} />
            </Stage>
          </div>
        </div>
        <More label={words.playsOut} note={words.playsOutLine}>
          {chart !== null && tokens !== null ? (
            <div className="grid grid-cols-1 items-center gap-6 @route:cols-route-long">
              <Saw chart={chart} window={tokens} reserve={context.reply_reserve} />
              <p className="text-note text-muted">{CHART_LEGEND}</p>
            </div>
          ) : (
            <p className="rounded-md border border-line bg-bg p-4 text-sm text-muted">{words.noWindow}</p>
          )}
        </More>
        <More label={words.exact} note={words.exactLine} forceOpen={exactFailed}>
          {percent("clear_at", "Clear at", "When the history passes this share of the room, old tool results shrink to one line.")}
          {percent("clear_to", "Clear to", "Shrinking stops when the history is down to this share.")}
          {percent("compact_at", words.summariseAt, "Past this share, older turns are replaced by a summary in what is sent.")}
          <Box
            label="Reply reserve"
            path="context.reply_reserve"
            value={String(context.reply_reserve)}
            hint="Tokens kept free for the reply."
            errors={errors}
            onCommit={(text) => commit("context.reply_reserve", text, parseAmount, (value) => ({ context: { reply_reserve: value } }))}
          />
          <Box
            label="Keep loaded for"
            path="context.keep_alive"
            value={context.keep_alive ?? ""}
            hint={words.keepAliveHint}
            errors={errors}
            onCommit={(text) => onChange({ context: { keep_alive: text.trim() === "" ? null : text.trim() } })}
          />
        </More>
      </Part>
    </div>
  );
}

/** Settings › Context: reads `routing.get` and saves each change with `routing.set`. */
export function ContextSection() {
  const routing = useRouting();
  const listing = useModelList().data ?? null;
  const { errors, failure, save } = useRoutingSave();
  const window = useLocalWindow(routing.data?.picked.local ?? null);
  const models = useWindowRows(routing.data?.picked.local ?? null, listing);

  if (routing.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(routing.error, "Could not read the context settings.")}
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
      <ContextView values={routing.data} listing={listing} errors={errors} window={window} models={models} onChange={(patch) => void save(patch)} />
    </div>
  );
}
