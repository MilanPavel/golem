import {
  routeRows,
  routeRowsTitle,
  ROUTE_CHOICES,
  routeLabel,
  sessionModelOf,
  spendRows,
  type LadderRow,
  type RouteMode,
  type SpendRow,
} from "@golem/view";
import { useState } from "react";
import { useConfig, useCost, useModelList, useNavigate, useSession } from "../../store/page-context.tsx";
import { settingsPath } from "../../store/router.ts";
import type { SessionView } from "../../store/session-store.ts";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";

const DOT: Record<RouteMode, string> = { pinned: "bg-muted", local: "bg-allow", auto: "bg-clay" };

/** A thin bar: the share of a cap that is spent. */
function Bar({ row }: { row: SpendRow }) {
  if (row.ratio === null) return null;
  const percent = Math.round(row.ratio * 100);
  return (
    <div role="progressbar" aria-label={row.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 w-full overflow-hidden rounded-full bg-line">
      <div className={cn("h-full rounded-full", row.ratio >= 1 ? "bg-deny" : "bg-clay")} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** The ladder: a row for each tier. A row that is not ready is grey and, for a missing key, offers `Add key`. */
function Ladder({ title, rows, onNavigate }: { title: string; rows: readonly LadderRow[]; onNavigate: (path: string) => void }) {
  return (
    <ul aria-label={title} className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <li key={row.tier} data-ready={row.ready} className={cn("flex items-baseline gap-2 text-xs", row.ready ? "text-ink" : "text-faint")}>
          <span className="w-16 shrink-0 font-mono">{row.tier}</span>
          <span className="min-w-0 flex-1 truncate font-mono">{row.model ?? "none"}</span>
          <span className="shrink-0">{row.state}</span>
          {row.needsKey ? (
            <Link href={settingsPath("keys")} onNavigate={onNavigate} className="shrink-0 text-clay-ink underline">
              Add key
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The route of a chat: a chip with the mode, and a popover with the three-way switch, the models of
 * that mode (`routeRows`: the whole ladder only on `auto`), and today's spend. `ladder` and `spend` are empty until what the popover reads has arrived.
 */
export function RouteChipView({
  mode,
  ladder,
  spend,
  onSelect,
  onOpenChange,
  onNavigate,
  disabled = false,
}: {
  mode: RouteMode;
  ladder: readonly LadderRow[];
  spend: readonly SpendRow[];
  onSelect: (mode: RouteMode) => void;
  onOpenChange?: (open: boolean) => void;
  onNavigate: (path: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover {...(onOpenChange === undefined ? {} : { onOpenChange })}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={`Route: ${routeLabel(mode)}. Change it.`}
        title="How golem picks the model of each turn."
        className={cn(
          badgeVariants(),
          "cursor-pointer outline-offset-2 outline-clay hover:border-ink hover:text-ink focus-visible:outline-2 disabled:cursor-default disabled:opacity-60",
        )}
      >
        <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[mode])} />
        {routeLabel(mode)}
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Route and ladder" className="flex w-80 flex-col gap-3 max-sm:w-72">
        <div role="radiogroup" aria-label="Route" className="grid grid-cols-3 gap-1 rounded-md bg-line p-0.5">
          {ROUTE_CHOICES.map((choice) => (
            <button
              key={choice.mode}
              type="button"
              role="radio"
              aria-checked={choice.mode === mode}
              title={choice.hint}
              onClick={() => {
                if (choice.mode !== mode) onSelect(choice.mode);
              }}
              className={cn(
                "cursor-pointer rounded-sm px-2 py-1 text-xs outline-offset-2 outline-clay focus-visible:outline-2",
                choice.mode === mode ? "bg-surface font-medium text-ink shadow-soft" : "text-muted hover:text-ink",
              )}
            >
              {choice.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{ROUTE_CHOICES.find((choice) => choice.mode === mode)?.hint}</p>
        {ladder.length === 0 ? null : (
          <section className="flex flex-col gap-1.5">
            <h3 className="font-mono text-xs text-faint">{routeRowsTitle(mode)}</h3>
            <Ladder title={routeRowsTitle(mode)} rows={ladder} onNavigate={onNavigate} />
          </section>
        )}
        {spend.length === 0 ? null : (
          <section aria-label="Spend" className="flex flex-col gap-2">
            {spend.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted">{row.text}</span>
                <Bar row={row} />
              </div>
            ))}
          </section>
        )}
        <Link href={settingsPath("config")} onNavigate={onNavigate} className="text-xs text-clay-ink underline">
          Routing settings
        </Link>
      </PopoverContent>
    </Popover>
  );
}

const selectMode = ({ chat }: SessionView) => chat.route.mode;
const selectCwd = (view: SessionView) => view.cwd;
const selectModel = (view: SessionView) => view.model;

/** The chip for a session. What the popover shows is read when it opens, and not again until it is opened again. */
export function RouteChip({ sessionId, onSelect }: { sessionId: string; onSelect: (mode: RouteMode) => void }) {
  const mode = useSession(sessionId, selectMode);
  const cwd = useSession(sessionId, selectCwd);
  const model = useSession(sessionId, selectModel);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const models = useModelList(open);
  const config = useConfig(cwd, sessionId, open);
  const cost = useCost(open, sessionId);
  const listed = models.data?.models ?? [];
  const own = sessionModelOf({ profile: model?.profile ?? null, provider: model?.provider ?? null, name: model?.name ?? null }, listed);
  return (
    <RouteChipView
      mode={mode}
      ladder={models.data === undefined ? [] : routeRows(mode, listed, config.data?.routing, own)}
      spend={spendRows(cost.data, config.data?.routing)}
      onSelect={onSelect}
      onOpenChange={setOpen}
      onNavigate={(path) => {
        setOpen(false);
        navigate(path);
      }}
    />
  );
}
