import { ROUTING_WORDS, parseAmount, turnOutcome, windowCaption, type Situation } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ModelListResult } from "../../store/models.ts";
import { useCost, useModelList, useNavigate, usePageActions, usePulls, useRouting } from "../../store/page-context.tsx";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { settingsPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { FolderBrowser } from "../shell/folder-browser.tsx";
import { routingState } from "./routing-derive.ts";
import { RoutingExceptions, type FolderBrowserSlot } from "./routing-exceptions.tsx";
import { RoutingGate } from "./routing-gate.tsx";
import { RoutingLong } from "./routing-long.tsx";
import { RoutingModes } from "./routing-modes.tsx";
import { Box, More, type RoutingErrors } from "./routing-parts.tsx";
import { RoutingPath } from "./routing-path.tsx";
import { RoutingRightNow } from "./routing-summary.tsx";
import { RoutingTry, usePlayback } from "./routing-try.tsx";

export type { FolderBrowserSlot, RoutingErrors };

export type RoutingViewProps = {
  values: RoutingGetResult;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  /** What Auto gives for the local model on this Mac, or null when golem has no plan to name. */
  windowNote: string | null;
  /** The planned window of the local model in tokens, or null when golem has no plan to name. */
  planned?: number | null;
  /** Today's spend from `cost.get`, or null while it is not known. */
  spentToday?: number | null;
  /** Saves these keys. The daemon's answer comes back as `errors` and `values`. */
  onChange: (patch: RoutingSetParams) => void;
  /** Opens Settings › API keys. */
  onOpenKeys?: () => void;
  /** The folder browser for Add. The page passes the live one, the gallery a still one. */
  folderBrowser: FolderBrowserSlot;
};

/** Settings › Routing: every routing and context setting, each saving on its own. */
export function RoutingView({
  values,
  listing,
  pulls,
  errors: saved,
  windowNote,
  planned = null,
  spentToday = null,
  onChange,
  onOpenKeys = () => {},
  folderBrowser,
}: RoutingViewProps) {
  const gateId = `${useId()}-paid-gate`;
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [pressed, setPressed] = useState<Situation | null>(null);
  const errors = { ...saved, ...typed };
  const state = useMemo(() => routingState(values, listing, planned), [values, listing, planned]);
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
        planned={planned}
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
      <RoutingLong context={values.context} windowNote={windowNote} planned={planned} errors={errors} commit={commit} onChange={onChange} />
    </div>
  );
}

/** Settings › Routing: reads `routing.get` and saves each change with `routing.set`. */
export function RoutingSection() {
  const routing = useRouting();
  const listing = useModelList().data ?? null;
  const pulls = usePulls();
  const actions = usePageActions();
  const navigate = useNavigate();
  const cost = useCost();
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
  const planned = options.data?.default_from?.["num_ctx"] === "golem" ? Number(options.data.defaults["num_ctx"] ?? Number.NaN) || null : null;
  const note = planned === null ? null : windowCaption(local, planned, options.data?.memory?.ram_gb ?? null);

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
        planned={planned}
        spentToday={cost.data?.today.cost_usd ?? null}
        onChange={(patch) => void save(patch)}
        onOpenKeys={() => navigate(settingsPath("keys"))}
        folderBrowser={({ onPick, onCancel }) => <FolderBrowser initialPath={null} autoFocus onPick={onPick} onCancel={onCancel} />}
      />
    </div>
  );
}
