import {
  LADDER_TIERS,
  LINK_WHY,
  ROUTING_WORDS,
  autoLine,
  gateLabel,
  pathClosed,
  pickedBy,
  priceTag,
  windowSize,
  type PartState,
  type PathPart,
  type RoutingState,
} from "@golem/view";
import type { ReactNode } from "react";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { ModelPick } from "./routing-model-pick.tsx";
import { CARD, FieldError, Part, type RoutingErrors } from "./routing-parts.tsx";
import { tierInfo, usableModels, windowTokens, type Tier, type TierInfo } from "./routing-derive.ts";

/** What the try-it playback has lit so far: a state for each part of the path it passes. */
export type Lit = Partial<Record<PathPart, PartState>>;

const BADGE = "absolute -top-2.75 rounded-sm px-1.75 py-1 font-mono text-micro font-semibold leading-none";

function Lock({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d={closed ? "M5.5 7V5a2.5 2.5 0 0 1 5 0v2" : "M5.5 7V5a2.5 2.5 0 0 1 5 0"} />
    </svg>
  );
}

function Station({
  info,
  models,
  values,
  listing,
  pulls,
  errors,
  planned,
  ramGb,
  off,
  lit,
  onChange,
  onOpenKeys,
  className,
}: {
  info: TierInfo;
  models: readonly ListedModel[];
  values: RoutingGetResult;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  planned: number | null;
  ramGb: number | null;
  off: boolean;
  lit: PartState | undefined;
  onChange: (patch: RoutingSetParams) => void;
  onOpenKeys: () => void;
  className: string;
}) {
  const { tier, chosen, model, empty } = info;
  const words = LADDER_TIERS.find((item) => item.tier === tier);
  const title = words?.title ?? tier;
  const path = `routing.ladder.${tier}`;
  const errorId = `ladder-${tier}-error`;
  const tokens = tier === "local" ? windowTokens(values, planned) : (model?.ctx ?? null);
  const empties: Record<Tier, string> = {
    local: "No model is ready for this step.",
    budget: "No model is ready for this step, so the path ends at Local.",
    frontier: ROUTING_WORDS.path.noFrontier,
  };
  return (
    <div
      data-station={tier}
      data-state={lit}
      className={cn(
        "relative rounded-md border-2 border-line-strong bg-bg p-3.5 transition",
        empty && "border-dashed bg-transparent",
        off && "opacity-40",
        lit === "pass" && "border-ink",
        lit === "hit" && "border-clay bg-surface ring-4 ring-clay-soft",
        className,
      )}
    >
      {tier === "local" ? <span className={cn(BADGE, "left-3 bg-ink text-bg")}>{ROUTING_WORDS.path.start}</span> : null}
      <span
        className={cn(BADGE, "right-3 bg-clay text-on-clay transition duration-200", lit === "hit" ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}
        aria-hidden="true"
      >
        {ROUTING_WORDS.path.answer}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h4 className="text-chat font-semibold">{title}</h4>
        <span
          className={cn(
            "rounded-sm px-1.5 py-1 font-mono text-micro font-semibold leading-none whitespace-nowrap",
            tier === "local" ? "bg-allow-soft text-allow" : "bg-clay-soft text-clay-ink",
          )}
        >
          {priceTag(tier, empty || model === null ? null : (model.price ?? null))}
        </span>
      </div>
      <p className="mb-2.5 mt-0.5 text-note text-muted">{words?.line}</p>
      {empty ? (
        <div className="flex flex-col items-start gap-2.5">
          <p className="text-note text-muted">{empties[tier]}</p>
          {tier === "local" ? null : (
            <Button size="sm" onClick={onOpenKeys}>
              {ROUTING_WORDS.path.addKey}
            </Button>
          )}
        </div>
      ) : (
        <>
          <ModelPick
            label={title}
            value={chosen}
            listing={listing}
            models={models}
            pulls={pulls}
            emptyText={autoLine(values.picked[tier] ?? null)}
            onPick={(ref) => onChange({ ladder: { [tier]: ref } })}
            describedBy={errors[path] === undefined ? undefined : errorId}
            invalid={errors[path] !== undefined}
            className="w-full font-mono"
          />
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-note text-faint">
            <span className="text-clay-ink">{pickedBy(chosen !== null)}</span>
            {tokens === null ? null : <span>{`${windowSize(tokens)} window`}</span>}
            {model === null ? null : <span>{model.provider}</span>}
            {tier === "local" && ramGb !== null ? <span>{`${Math.round(ramGb)} GB Mac`}</span> : null}
          </div>
        </>
      )}
      <FieldError id={errorId} path={path} errors={errors} />
    </div>
  );
}

/** The arrow into a step: what sends a turn there, a wire, and for the first one the gate. */
function Link({ why, pass, dim, children, className }: { why: string; pass: boolean; dim: boolean; children?: ReactNode; className: string }) {
  return (
    <div
      data-link={pass ? "pass" : undefined}
      className={cn(
        "flex flex-col items-center px-2 py-3 text-center @route:mb-0 @route:self-end @route:py-0",
        dim && "opacity-30",
        className,
      )}
    >
      {/* The gate sits on the wire, so its caption keeps clear of it. */}
      <p className={cn("text-xs leading-snug text-faint", children === undefined ? "mb-2" : "mb-2 @route:mb-5")}>{why}</p>
      <div
        aria-hidden="true"
        className={cn(
          "relative order-3 h-5.5 w-0.5 bg-current after:absolute after:-bottom-px after:-right-1 after:border-5 after:border-transparent after:border-t-current",
          "@route:order-none @route:-mx-2 @route:h-0.5 @route:w-auto @route:self-stretch",
          "@route:after:-right-px @route:after:-top-1 @route:after:bottom-auto @route:after:border-t-transparent @route:after:border-l-current",
          pass ? "text-clay" : "text-line-strong",
        )}
      />
      {children}
    </div>
  );
}

/** Part C, the path: Local, the gate, Budget and Frontier as steps that rise from left to right. */
export function RoutingPath({
  values,
  listing,
  pulls,
  errors,
  state,
  planned,
  lit,
  onChange,
  onOpenKeys,
  onToGate,
  more,
  children,
}: {
  values: RoutingGetResult;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  state: RoutingState;
  planned: number | null;
  lit: Lit;
  onChange: (patch: RoutingSetParams) => void;
  onOpenKeys: () => void;
  onToGate: () => void;
  /** The settings the picture does not show, in a closed disclosure. */
  more: ReactNode;
  /** Try it, under the path. */
  children: ReactNode;
}) {
  const pinned = state.mode === "pinned";
  const closed = pathClosed(state);
  const models = usableModels(listing);
  const gate = lit.gate;
  const station = (tier: Tier, className: string) => (
    <Station
      info={tierInfo(values, listing, tier)}
      models={models.filter((model) => model.tier === tier)}
      values={values}
      listing={listing}
      pulls={pulls}
      errors={errors}
      planned={planned}
      ramGb={listing?.ram_gb ?? null}
      off={pinned || (tier !== "local" && closed)}
      lit={lit[tier]}
      onChange={onChange}
      onOpenKeys={onOpenKeys}
      className={className}
    />
  );
  return (
    <Part title={ROUTING_WORDS.path.title} line={ROUTING_WORDS.path.line}>
      <div className={cn(CARD, "flex flex-col gap-4 p-5")}>
        <div className="grid grid-cols-1 items-end @route:cols-route-track">
          {station("local", "")}
          <Link why={LINK_WHY.gate} pass={gate === "ask"} dim={pinned} className="@route:mb-link-gate">
            <button
              type="button"
              onClick={onToGate}
              title={ROUTING_WORDS.path.gateGo}
              aria-label={`Paid gate: ${gateLabel(state)}. ${ROUTING_WORDS.path.gateGo}`}
              className={cn(
                "relative z-10 order-2 mb-1.5 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 bg-surface py-1 pl-1.5 pr-2.5 text-note font-medium @route:order-none @route:mb-0 @route:-mt-3.75",
                gate === "ask"
                  ? "border-wait bg-wait-soft text-wait"
                  : gate === "stop"
                    ? "border-deny bg-deny-soft text-deny"
                    : closed
                      ? "border-dashed border-line-strong text-muted"
                      : "border-line-strong",
              )}
            >
              <Lock closed={closed} />
              <span>{gateLabel(state)}</span>
            </button>
          </Link>
          {station("budget", "@route:mb-rise-budget")}
          <Link why={LINK_WHY.frontier} pass={false} dim={pinned} className="@route:mb-link-frontier" />
          {station("frontier", "@route:mb-rise-frontier")}
        </div>
        {pinned ? <p className="rounded-md bg-slip px-3.5 py-2.5 text-sm text-ink-soft">{ROUTING_WORDS.path.pinned}</p> : null}
        {children}
        {more}
      </div>
    </Part>
  );
}
