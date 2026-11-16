import {
  CHART_LEGEND,
  ROUTING_WORDS,
  contextChart,
  parseAmount,
  parsePercent,
  roomExample,
  stageLabels,
  toPercent,
  windowSize,
  type ContextChart,
} from "@golem/view";
import { useRef, useState, type ReactNode } from "react";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { cn } from "../../ui/cn.ts";
import { Box, CARD, FieldError, More, Part, PillChoices, Stepper, type RoutingErrors } from "./routing-parts.tsx";

const X0 = 30;
const X1 = 312;
const TOP = 12;
const BASE = 130;
const y = (pct: number): number => BASE - (pct / 100) * (BASE - TOP);

/** How full the window gets during a long chat, as a line that drops back at each clear. */
function Saw({ chart, window, reserve }: { chart: ContextChart; window: number; reserve: number }) {
  const px = (x: number): number => X0 + x * (X1 - X0);
  const line = chart.line.map((point) => `${px(point.x).toFixed(1)},${y(point.pct).toFixed(1)}`).join(" ");
  const last = chart.line[chart.line.length - 1];
  const text = "fill-faint font-mono text-axis";
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="How full the window gets during a long chat" className="block h-auto w-full rounded-md border border-line bg-bg">
      <rect className="fill-line" x={X0} y={TOP} width={X1 - X0} height={y(100 - chart.reply) - TOP} opacity=".7" />
      <polygon className="fill-clay-soft" points={`${X0},${BASE} ${line} ${px(last?.x ?? 1).toFixed(1)},${BASE}`} />
      <polyline className="fill-none stroke-clay" strokeWidth="2" strokeLinejoin="round" points={line} />
      <line className="stroke-wait" strokeWidth="1.2" strokeDasharray="4 4" x1={X0} x2={X1} y1={y(chart.clearAt)} y2={y(chart.clearAt)} />
      <line className="stroke-ctx-summary" strokeWidth="1.2" strokeDasharray="4 4" x1={X0} x2={X1} y1={y(chart.compactAt)} y2={y(chart.compactAt)} />
      <text className={text} x={X0 + 4} y={TOP + 9}>{`kept for the reply · ${windowSize(reserve)}`}</text>
      <text className="fill-wait font-mono text-axis" x={X0 + 4} y={y(chart.clearAt) - 3}>1 · clear results</text>
      <text className="fill-ctx-summary font-mono text-axis" x={X0 + 4} y={y(chart.compactAt) - 3}>2 · summarise</text>
      <text className={text} x="4" y={TOP + 4}>{windowSize(window)}</text>
      <text className={text} x="4" y={BASE}>0</text>
      <text className={text} x={X0} y={144}>the chat goes on →</text>
      {chart.marks.map((mark, index) =>
        mark.kind === "clear" ? (
          <circle key={index} cx={px(mark.x)} cy={y(mark.pct)} r="3" className="fill-wait" />
        ) : (
          <rect key={index} x={px(mark.x) - 3.5} y={y(mark.pct) - 3.5} width="7" height="7" className="fill-ctx-summary" />
        ),
      )}
    </svg>
  );
}

function Stage({ when, tone, children }: { when?: string; tone?: "wait" | "summary"; children: ReactNode }) {
  return (
    <div className="border-t border-line py-3.5 first:border-t-0 first:pt-0">
      {when === undefined ? null : (
        <div className={cn("mb-1.5 font-mono text-micro font-semibold uppercase leading-none tracking-wider", tone === "wait" ? "text-wait" : tone === "summary" ? "text-ctx-summary" : "text-faint")}>
          {when}
        </div>
      )}
      {children}
    </div>
  );
}

const HEAD = "flex items-center justify-between gap-3";

/** The step-1 slider. It saves when it is let go, and only when it moved. */
function ClearSlider({ share, error, onSave }: { share: number; error: string | undefined; onSave: (share: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const moved = useRef<number | null>(null);
  const shown = draft ?? Math.min(80, Math.max(50, Math.round(share * 100)));
  const done = () => {
    const value = moved.current;
    moved.current = null;
    if (value !== null && value / 100 !== share) onSave(value / 100);
    setDraft(null);
  };
  return (
    <input
      type="range"
      min={50}
      max={80}
      step={5}
      value={shown}
      aria-label="Start clearing at"
      aria-valuetext={`${shown}% full`}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={error === undefined ? undefined : "clear-at-error"}
      onChange={(event) => {
        moved.current = Number(event.currentTarget.value);
        setDraft(moved.current);
      }}
      onPointerUp={done}
      onKeyUp={done}
      onBlur={done}
      className="mt-2 w-full accent-clay"
    />
  );
}

/** Part F: how golem keeps a long chat inside the window of a local model. */
export function RoutingLong({
  context,
  windowNote,
  planned,
  errors,
  commit,
  onChange,
}: {
  context: RoutingGetResult["context"];
  windowNote: string | null;
  /** The planned window of the local model in tokens, or null when golem has no plan to name. */
  planned: number | null;
  errors: RoutingErrors;
  commit: (path: string, text: string, parse: typeof parseAmount, send: (value: number | null) => RoutingSetParams) => void;
  onChange: (patch: RoutingSetParams) => void;
}) {
  const [wantNumber, setWantNumber] = useState(false);
  const words = ROUTING_WORDS.long;
  const stages = stageLabels(context);
  const fixed = typeof context.window === "number";
  const tokens = fixed ? context.window : planned;
  const chart = contextChart(context, typeof tokens === "number" ? tokens : null);
  const windowKind = wantNumber || fixed ? "fixed" : context.window === "auto" ? "auto" : null;
  const step = (key: "keep_results" | "keep_turns", by: number, min: number) =>
    onChange({ context: { [key]: Math.max(min, context[key] + by) } });
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
  const inMore = ["clear_at", "clear_to", "compact_at", "reply_reserve", "keep_alive"].some((key) => errors[`context.${key}`] !== undefined);
  const windowText =
    context.window === "ollama" && !wantNumber
      ? "golem sends no window, so Ollama picks its own."
      : (windowNote ?? "golem plans the window from the model and this Mac's memory.");
  return (
    <Part title={words.title} line={words.line}>
      <div className={cn(CARD, "grid grid-cols-1 items-start gap-7 p-5 @route:cols-route-long")}>
        <div>
          {chart !== null && typeof tokens === "number" ? (
            <Saw chart={chart} window={tokens} reserve={context.reply_reserve} />
          ) : (
            <p className="rounded-md border border-line bg-bg p-4 text-sm text-muted">{words.noWindow}</p>
          )}
          <p className="mt-2 text-note text-muted">{CHART_LEGEND}</p>
          <p className="mt-3 rounded-md bg-slip px-3 py-2.5 text-note text-ink-soft">
            <b className="font-semibold">{words.nothingDeleted}</b>
            {words.nothingDeletedMore}
          </p>
        </div>
        <div className="flex flex-col">
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
            <p className="mt-1 text-note leading-normal text-muted">{roomExample(typeof tokens === "number" ? tokens : null, context.reply_reserve)}</p>
            <FieldError id="reply-reserve-error" path="context.reply_reserve" errors={errors} />
          </Stage>
          <Stage when={stages.one} tone="wait">
            <b className="text-sm font-semibold">{words.clear}</b>
            <ClearSlider share={context.clear_at} error={errors["context.clear_at"]} onSave={(share) => onChange({ context: { clear_at: share } })} />
            <FieldError id="clear-at-error" path="context.clear_at" errors={errors} />
            <p className="mt-1 text-note leading-normal text-muted">{words.clearLine}</p>
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
          <Stage>
            <div className={HEAD}>
              <b className="text-sm font-semibold">{words.window}</b>
              <PillChoices
                legend={words.window}
                path={wantNumber || fixed ? "context.window.pill" : "context.window"}
                choices={[
                  { value: "auto", title: "auto" },
                  { value: "fixed", title: "fixed" },
                ]}
                value={windowKind}
                errors={errors}
                onChoose={(kind) => {
                  setWantNumber(kind === "fixed");
                  if (kind === "auto") onChange({ context: { window: "auto" } });
                }}
              />
            </div>
            {wantNumber || fixed ? (
              <div className="mt-2">
                <Box
                  label="Window size"
                  path="context.window"
                  value={fixed ? String(context.window) : ""}
                  suffix="tokens"
                  hint="Tokens, from 512 to 262144."
                  errors={errors}
                  onCommit={(text) => commit("context.window", text, parseAmount, (value) => ({ context: { window: value } }))}
                />
              </div>
            ) : (
              <p className="mt-1 text-note leading-normal text-muted">{windowText}</p>
            )}
          </Stage>
          <More label={ROUTING_WORDS.more} forceOpen={inMore}>
            {percent("clear_at", "Clear at", "When the history passes this share of the window, old tool results shrink to one line.")}
            {percent("clear_to", "Clear to", "Shrinking stops when the history is down to this share.")}
            {percent("compact_at", "Summarise at", "Past this share, older turns are replaced by a summary in what is sent.")}
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
              hint="How long Ollama keeps the model in memory after a call, such as 30m. Empty sends none."
              errors={errors}
              onCommit={(text) => onChange({ context: { keep_alive: text.trim() === "" ? null : text.trim() } })}
            />
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={context.window === "ollama"}
                onChange={(event) => {
                  setWantNumber(false);
                  onChange({ context: { window: event.currentTarget.checked ? "ollama" : "auto" } });
                }}
              />
              <span className="flex flex-col">
                <span>{"Use Ollama's default window"}</span>
                <span className="text-xs text-muted">golem sends no window, so Ollama picks its own.</span>
              </span>
            </label>
          </More>
        </div>
      </div>
    </Part>
  );
}
