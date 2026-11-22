import {
  routeRows,
  routeRowsTitle,
  ROUTE_CHOICES,
  sessionModelOf,
  spendRows,
  type LadderRow,
  type RouteMode,
  type SpendRow,
} from "@golem/view";
import { useConfig, useCost, useModelList, useSession } from "../../store/page-context.tsx";
import { settingsPath } from "../../store/router.ts";
import type { SessionView } from "../../store/session-store.ts";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { Code } from "../../ui/code.tsx";

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
          <span className="w-16 shrink-0">{row.tier}</span>
          <span className="min-w-0 flex-1 truncate">{row.model === null ? "none" : <Code tone="muted">{row.model}</Code>}</span>
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
 * The route of a chat, the first section of the model chip's menu: the three-way switch, the models of
 * that mode (`routeRows`: the whole ladder only on `auto`), and today's spend. `ladder` and `spend` are
 * empty until what the panel reads has arrived.
 */
export function RoutePanelView({
  mode,
  ladder,
  spend,
  onSelect,
  onNavigate,
}: {
  mode: RouteMode;
  ladder: readonly LadderRow[];
  spend: readonly SpendRow[];
  onSelect: (mode: RouteMode) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
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
          <h3 className="text-meta text-faint">{routeRowsTitle(mode)}</h3>
          <Ladder title={routeRowsTitle(mode)} rows={ladder} onNavigate={onNavigate} />
        </section>
      )}
      {spend.length === 0 ? null : (
        <section aria-label="Spend" className="flex flex-col gap-2">
          {spend.map((row) => (
            <div key={row.label} className="flex flex-col gap-1">
              <span className="text-meta text-muted">{row.text}</span>
              <Bar row={row} />
            </div>
          ))}
        </section>
      )}
      <Link href={settingsPath("config")} onNavigate={onNavigate} className="text-xs text-clay-ink underline">
        Routing settings
      </Link>
    </div>
  );
}

const selectMode = ({ chat }: SessionView) => chat.route.mode;
const selectCwd = (view: SessionView) => view.cwd;
const selectModel = (view: SessionView) => view.model;

/** The panel for a session. What it shows is read while `open`, and not again until it is opened again. */
export function RoutePanel({
  sessionId,
  open,
  onSelect,
  onNavigate,
}: {
  sessionId: string;
  open: boolean;
  onSelect: (mode: RouteMode) => void;
  onNavigate: (path: string) => void;
}) {
  const mode = useSession(sessionId, selectMode);
  const cwd = useSession(sessionId, selectCwd);
  const model = useSession(sessionId, selectModel);
  const models = useModelList(open);
  const config = useConfig(cwd, sessionId, open);
  const cost = useCost(open, sessionId);
  const listed = models.data?.models ?? [];
  const own = sessionModelOf({ profile: model?.profile ?? null, provider: model?.provider ?? null, name: model?.name ?? null }, listed);
  return (
    <RoutePanelView
      mode={mode}
      ladder={models.data === undefined ? [] : routeRows(mode, listed, config.data?.routing, own)}
      spend={spendRows(cost.data, config.data?.routing)}
      onSelect={onSelect}
      onNavigate={onNavigate}
    />
  );
}
