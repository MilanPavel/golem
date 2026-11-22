import { CONTEXT_WORDS, NO_LOCAL_WINDOW, ROUTING_WORDS, handoffChips, parseAmount, turnOutcome, type LocalWindow, type Situation } from "@golem/view";
import { useId, useMemo, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ModelListResult } from "../../store/models.ts";
import { useCost, useModelList, useNavigate, usePulls, useRouting } from "../../store/page-context.tsx";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { settingsPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { FolderBrowser } from "../shell/folder-browser.tsx";
import { routingState, windowKind } from "./routing-derive.ts";
import { RoutingExceptions, type FolderBrowserSlot } from "./routing-exceptions.tsx";
import { RoutingGate } from "./routing-gate.tsx";
import { RoutingModes } from "./routing-modes.tsx";
import { Box, CARD, More, type RoutingErrors } from "./routing-parts.tsx";
import { RoutingPath } from "./routing-path.tsx";
import { RoutingRightNow } from "./routing-summary.tsx";
import { RoutingTry, usePlayback } from "./routing-try.tsx";
import { useLocalWindow } from "./use-local-window.ts";
import { useRoutingSave } from "./use-routing-save.ts";
import { cn } from "../../ui/cn.ts";

export type { FolderBrowserSlot, RoutingErrors };

export type RoutingViewProps = {
  values: RoutingGetResult;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  /** The window the local model gets, and where it comes from. */
  window?: LocalWindow;
  /** Today's spend from `cost.get`, or null while it is not known. */
  spentToday?: number | null;
  /** Saves these keys. The daemon's answer comes back as `errors` and `values`. */
  onChange: (patch: RoutingSetParams) => void;
  /** Opens Settings › Models. */
  onOpenKeys?: () => void;
  /** Opens Settings › Context. */
  onOpenContext?: () => void;
  /** The folder browser for Add. The page passes the live one, the gallery a still one. */
  folderBrowser: FolderBrowserSlot;
};

/** The last card of Routing: the three numbers of Settings › Context, and the way there. */
function ContextHandoff({ values, window, onOpen }: { values: RoutingGetResult; window: LocalWindow; onOpen: () => void }) {
  const words = CONTEXT_WORDS.handoff;
  return (
    <section aria-label={words.title} className={cn(CARD, "flex flex-wrap items-center gap-x-5 gap-y-3 border-dashed px-5 py-4 shadow-none")}>
      <div className="flex min-w-60 flex-1 flex-col gap-1.5">
        <h3 className="font-semibold">{words.title}</h3>
        <p className="text-note text-muted">{words.line}</p>
        <ul className="flex flex-wrap gap-1.5">
          {handoffChips(values.context, window, windowKind(values.context)).map((chip) => (
            <li key={chip} className="rounded-md border border-line-strong bg-slip px-1.5 py-0.5 text-meta font-medium whitespace-nowrap text-ink">
              {chip}
            </li>
          ))}
        </ul>
      </div>
      <Button size="sm" onClick={onOpen}>
        {`${words.open} →`}
      </Button>
    </section>
  );
}

/** Settings › Routing: the routing settings, each saving on its own. It ends with a card to Settings › Context. */
export function RoutingView({
  values,
  listing,
  pulls,
  errors: saved,
  window = NO_LOCAL_WINDOW,
  spentToday = null,
  onChange,
  onOpenKeys = () => {},
  onOpenContext = () => {},
  folderBrowser,
}: RoutingViewProps) {
  const gateId = `${useId()}-paid-gate`;
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [pressed, setPressed] = useState<Situation | null>(null);
  const errors = { ...saved, ...typed };
  const state = useMemo(() => routingState(values, listing, window), [values, listing, window]);
  const outcome = pressed === null ? null : turnOutcome(pressed, state);
  const lit = usePlayback(outcome);

  /** Saves a typed amount: empty clears the key, a word is refused where it is typed. */
  function commit(path: string, text: string, parse: typeof parseAmount, send: (value: number | null) => RoutingSetParams): void {
    const parsed = parse(text);
    setTyped((now) => {
      const rest = Object.fromEntries(Object.entries(now).filter(([key]) => key !== path));
      return parsed.ok ? rest : { ...rest, [path]: parsed.message };
    });
    if (parsed.ok) onChange(send(parsed.value));
  }

  return (
    <div className="@container flex max-w-6xl flex-col gap-9">
      <p className="-mt-1 max-w-prose text-muted">{ROUTING_WORDS.lead}</p>
      <RoutingRightNow state={state} />
      <RoutingModes mode={values.routing.mode} errors={errors} onChoose={(mode) => onChange({ routing: { mode } })} />
      <RoutingPath
        values={values}
        listing={listing}
        pulls={pulls}
        errors={errors}
        state={state}
        window={window}
        lit={lit}
        onChange={onChange}
        onOpenKeys={onOpenKeys}
        onToGate={() => document.getElementById(gateId)?.scrollIntoView?.({ behavior: "smooth", block: "center" })}
        more={
          <More label={ROUTING_WORDS.more} forceOpen={errors["routing.budget_max_price"] !== undefined}>
            <Box
              label="Budget tier price limit"
              path="routing.budget_max_price"
              value={String(values.routing.budget_max_price)}
              prefix="$"
              suffix="per million tokens"
              hint="A hosted model at or below this price, blended over input and output, is in the budget tier."
              errors={errors}
              onCommit={(text) => commit("routing.budget_max_price", text, parseAmount, (value) => ({ routing: { budget_max_price: value } }))}
            />
          </More>
        }
      >
        <RoutingTry window={state.window} pressed={pressed} outcome={outcome} onPress={setPressed} />
      </RoutingPath>
      <RoutingGate id={gateId} values={values} state={state} errors={errors} spentToday={spentToday} commit={commit} onChange={onChange} />
      <RoutingExceptions values={values} listing={listing} pulls={pulls} errors={errors} onChange={onChange} folderBrowser={folderBrowser} />
      <ContextHandoff values={values} window={window} onOpen={onOpenContext} />
    </div>
  );
}

/** Settings › Routing: reads `routing.get` and saves each change with `routing.set`. */
export function RoutingSection() {
  const routing = useRouting();
  const listing = useModelList().data ?? null;
  const pulls = usePulls();
  const navigate = useNavigate();
  const cost = useCost();
  const { errors, failure, save } = useRoutingSave();
  const window = useLocalWindow(routing.data?.picked.local ?? null);

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
  if (routing.data === undefined) return <p className="text-body text-muted">asking the daemon…</p>;
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
        window={window}
        spentToday={cost.data?.today.cost_usd ?? null}
        onChange={(patch) => void save(patch)}
        onOpenKeys={() => navigate(settingsPath("models"))}
        onOpenContext={() => navigate(settingsPath("context"))}
        folderBrowser={({ onPick, onCancel }) => <FolderBrowser initialPath={null} autoFocus onPick={onPick} onCancel={onCancel} />}
      />
    </div>
  );
}
