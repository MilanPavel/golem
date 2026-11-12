import {
  daemonServiceRow,
  defaultGone,
  engineSelected,
  HOSTED_PROVIDERS,
  keepCommand,
  keyMissing,
  namesModel,
  pageServiceRow,
  pickerName,
  providerName,
  pullSpeed,
} from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useModelList, useNavigate, usePageActions, usePageHost, usePulls, useSetupStatus } from "../../store/page-context.tsx";
import { welcomePath } from "../../store/router.ts";
import { pullShare, pullText, shortName } from "../models/index.ts";
import type { KeyProvider } from "../setup/setup-form.tsx";
import { useSetupActions } from "../setup/use-setup-actions.ts";
import type { EngineChoice, OllamaPhase } from "./engine-step.tsx";
import type { ReadyModel } from "./ready-step.tsx";
import { TOOLS_OFFERED } from "./tools-step.tsx";
import { finishWelcome, leaveWelcome, setPendingModel, setPullSpeed, useWelcomeProgress } from "./welcome-store.ts";
import { nextStep, stepStates, type WelcomeStep } from "./welcome-steps.ts";
import { WelcomeView } from "./welcome-view.tsx";

/** How often the page looks for Ollama again while the person installs it by hand. */
const WATCH_MS = 5000;

const visible = (): boolean => document.visibilityState === "visible";

/** Back to the screen the person came from, or home when there is none. */
function leave(navigate: (path: string) => void): void {
  if (history.length > 1) history.back();
  else navigate("/");
}

/**
 * The welcome page of the page's route: Engine, Model, Tools and Ready, read from the model list
 * and `setup.status`. The step is in the URL. Each Engine fix goes through the same hook as Settings → Setup.
 */
export function WelcomeScreen({ step, from }: { step: WelcomeStep; from: "send" | null }) {
  const navigate = useNavigate();
  const page = usePageActions();
  const connection = useConnection();
  const pageHost = usePageHost();
  const pulls = usePulls();
  const progress = useWelcomeProgress();
  const status = useSetupStatus(true);
  const listing = useModelList(true).data ?? null;
  const { refetch } = status;
  const setupActions = useSetupActions(refetch);
  const [picked, setPicked] = useState<EngineChoice | null>(null);
  const [pickedProvider, setPickedProvider] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const choice: EngineChoice = picked ?? (engineSelected(listing) === 1 ? "key" : "local");

  // Looks at the machine again without a spinner: for the checks the page makes by itself.
  const look = useCallback((): void => {
    Promise.all([page.refreshModels(), refetch()]).catch(() => undefined);
  }, [page, refetch]);

  const setup = listing?.setup;
  const phase: OllamaPhase =
    setupActions.state.running === "install"
      ? "installing"
      : setupActions.state.running === "start"
        ? "starting"
        : setup?.ollama_running === true
          ? "running"
          : setup?.ollama_installed === true
            ? "stopped"
            : setupActions.state.noBrew
              ? "no_brew"
              : "missing";

  // With no Homebrew the person installs Ollama themselves: look again every few seconds while the tab is seen.
  const watching = step === "engine" && choice === "local" && phase === "no_brew";
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      if (visible()) look();
    }, WATCH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [watching, look]);

  // A key is set in a terminal and pushes no event: look again when the person comes back to the tab.
  const awaitingKey = step === "engine" && choice === "key";
  useEffect(() => {
    if (!awaitingKey) return;
    const back = (): void => {
      if (visible()) look();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [awaitingKey, look]);

  const keys = new Set(setup?.keys ?? []);
  const providers: KeyProvider[] = HOSTED_PROVIDERS.map((item) => ({
    id: item.id,
    name: item.name,
    blurb: item.blurb,
    saved: keys.has(item.id) || (listing !== null && !keyMissing(listing, item.id) && listing.providers.some((each) => each.provider === item.id && each.status === "ready")),
  }));
  const provider = (providers.find((item) => item.id === pickedProvider) ?? providers.find((item) => !item.saved) ?? providers[0])?.id ?? "anthropic";
  const engineReady = choice === "local" ? phase === "running" : providers.find((item) => item.id === provider)?.saved === true;

  const defaultModel = listing === null ? null : (listing.models.find((model) => namesModel(model, listing.default)) ?? null);
  const defaultReady = defaultModel?.status === "ready";
  const pending = progress.pending;
  // The download the page waits on: the one it was told to, else the first that runs while no default is ready.
  const activeRef = pending?.ref ?? (defaultReady ? null : ([...pulls.active.keys()][0] ?? null));
  const entry = activeRef === null ? undefined : pulls.active.get(activeRef);
  const failure = activeRef === null ? undefined : pulls.failed.get(activeRef);
  const downloading = !defaultReady && activeRef !== null && failure === undefined && (entry !== undefined || pending !== null);

  // The download ended and the default is set: the page has nothing left to wait for.
  useEffect(() => {
    if (pending !== null && defaultReady) setPendingModel(null);
  }, [pending, defaultReady]);

  // The speed of the last download that was measured, to say how long the others take. Whole MB/s, so it does not stir on every tick.
  const measured = [...pulls.active.values()].map((each) => pullSpeed(each.track)).find((each) => each !== null) ?? null;
  useEffect(() => {
    if (measured !== null) setPullSpeed(Math.max(1, Math.round(measured / 1e6)) * 1e6);
  }, [measured]);

  const states = stepStates(step, TOOLS_OFFERED);
  const goTo = (to: WelcomeStep): void => {
    navigate(welcomePath(to, from), { replace: true });
  };
  const advanceFrom = (at: WelcomeStep): void => {
    const to = nextStep(at, TOOLS_OFFERED);
    if (to !== null) goTo(to);
  };

  // A step change moves focus to the page, so the key that pressed Continue is not left on a button that went.
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    root.current?.focus();
  }, [step]);

  function continueFromModel(): void {
    if (!defaultReady && downloading && activeRef !== null && pending === null) {
      const named = listing?.models.find((model) => model.ref === activeRef);
      const name = named === undefined ? activeRef : pickerName(named);
      // The model becomes the default when the download ends, with this page closed.
      page.defaultWhenPulled(activeRef, name);
      setPendingModel({ ref: activeRef, name });
    }
    advanceFrom("model");
  }

  const download =
    downloading && activeRef !== null ? { id: shortName(activeRef), share: pullShare(entry, null), text: entry === undefined ? "almost there" : pullText(entry) } : null;

  // The engine the model runs on, else the one chosen on the first step.
  const engineOf = defaultReady
    ? (defaultModel?.provider ?? null)
    : activeRef === null
      ? null
      : activeRef.slice(0, activeRef.indexOf("/"));
  const engineId = engineOf ?? (choice === "local" ? "ollama" : provider);
  const engineLine = engineId === "ollama" ? "Ollama on this Mac" : `${providerName(engineId)} with an API key`;
  const readyModel: ReadyModel =
    defaultReady && defaultModel !== null
      ? { kind: "ready", text: `${shortName(defaultModel.ref)} · default` }
      : download !== null
        ? { kind: "downloading", ...download }
        : failure !== undefined && activeRef !== null
          ? { kind: "failed", text: `${shortName(activeRef)} · ${failure}` }
          : { kind: "none" };

  const rows = status.isError ? null : (status.data?.rows ?? null);
  const serviceKept = rows === null ? true : pageServiceRow(daemonServiceRow(rows), connection.daemonVersion ?? "").state === "ok";
  const keepAt = keepCommand(serviceKept, pageHost.kept);

  const banner =
    step === "model" && listing !== null && defaultGone(listing)
      ? `Your default model ${listing.default ?? ""} is no longer installed. Pick another to keep chatting.`
      : null;

  const start = (): void => {
    finishWelcome();
    if (from === "send") leave(navigate);
    else navigate("/");
  };

  return (
    <WelcomeView
      rootRef={root}
      step={step}
      states={states}
      working={phase === "installing" || phase === "starting" || downloading}
      banner={banner}
      onStep={goTo}
      onLater={() => {
        leaveWelcome(step);
        navigate("/");
      }}
      engine={{
        choice,
        onChoice: setPicked,
        ollama: phase,
        downloaded: listing?.models.filter((model) => model.provider === "ollama" && model.status === "ready").length ?? 0,
        actions: setupActions.state,
        onInstall: setupActions.install,
        onCancelInstall: setupActions.cancelInstall,
        onStart: setupActions.start,
        onCheck: setupActions.checkAgain,
        providers,
        provider,
        onProvider: setPickedProvider,
        ready: engineReady,
        onContinue: () => {
          advanceFrom("engine");
        },
      }}
      model={{
        listing,
        pulls,
        speed: progress.speed,
        // The model becomes the default when the download ends, with this page closed.
        onDownload: async (model) => {
          const name = pickerName(model);
          await page.pull(model.ref);
          page.defaultWhenPulled(model.ref, name);
          setPendingModel({ ref: model.ref, name });
          advanceFrom("model");
        },
        onUse: async (model) => {
          if (!namesModel(model, listing?.default ?? null)) await page.setDefault(pickerName(model));
          advanceFrom("model");
        },
        onStop: async (model) => {
          await page.cancelPull(model.ref);
          if (progress.pending?.ref === model.ref) setPendingModel(null);
        },
        onContinue: continueFromModel,
      }}
      tools={{
        onContinue: () => {
          advanceFrom("tools");
        },
      }}
      ready={{
        engine: engineLine,
        model: readyModel,
        tools: "skipped",
        toolsSkipped: !TOOLS_OFFERED,
        keepNote: keepAt === null ? null : serviceKept ? { command: keepAt, page: "only" } : { command: keepAt },
        fromSend: from === "send",
        onStart: start,
      }}
    />
  );
}
