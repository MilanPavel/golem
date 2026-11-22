import { useMemo, useState, type ReactNode } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { AuthKeyStatus } from "../../../store/keys.ts";
import type { ListedModel, ModelListResult } from "../../../store/models.ts";
import type { OllamaSettingsSetParams, OllamaSettingsSetResult, OllamaSettingsValues } from "../../../store/notifications.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { LockIcon, MoreIcon } from "../../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../../ui/menu.tsx";
import { ProviderIcon } from "../../../ui/provider-icons.tsx";
import { withActivePulls } from "../../models/model-text.ts";
import type { SetupActions } from "../../setup/use-setup-actions.ts";
import type { HfActions, HfTabProps } from "./hf-tab.tsx";
import { GetModelsSheet } from "./get-models-sheet.tsx";
import { groupProviders, isStarred, keyWhere, modelsOf, ollamaState, providerEntry, usableModels, type ProviderEntry } from "./derive.ts";
import { ModelTable } from "./models-table.tsx";
import { OllamaPanel } from "./ollama-panel.tsx";
import { OllamaSettingsSheet } from "./ollama-settings-sheet.tsx";
import { ALL, ProviderList } from "./provider-list.tsx";
import { KeySheet, ProviderSetup } from "./provider-setup.tsx";

/** What the page does. Each call rejects with the daemon's message. */
export type ModelsActions = {
  /** Puts the model in the model menu or takes it out. */
  star(ref: string, starred: boolean): Promise<void>;
  /** Removes a model from Ollama. */
  remove(ref: string): Promise<void>;
  /** Stops a download. */
  stop(ref: string): Promise<void>;
  /** Starts a download. */
  pull(ref: string): Promise<void>;
  /** Hugging Face: the search and a repo's sizes. */
  hf: HfActions;
  /** Saves `[ollama]` settings. A refusal is in the result. */
  saveOllama(params: OllamaSettingsSetParams): Promise<OllamaSettingsSetResult>;
};

export type ModelsViewProps = {
  listing: ModelListResult | null;
  keys: readonly AuthKeyStatus[];
  /** `ollama.settings.get`, or null before it answered. */
  ollama: OllamaSettingsValues | null;
  pulls: PullsSnapshot;
  setup: SetupActions;
  actions: ModelsActions;
  /** Where the page starts, for the gallery. */
  initial?: { selected?: string; sheet?: "get" | "settings" | "key"; tab?: string; removing?: string; hf?: HfTabProps["initial"] };
};

type Sheet = "get" | "settings" | "key" | null;

function Head({ provider, status, children }: { provider: ProviderEntry; status: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        aria-hidden="true"
        className={
          provider.kind === "later"
            ? "grid size-9 place-items-center rounded-md border-2 border-dashed border-line-strong text-faint"
            : "grid size-9 place-items-center rounded-md bg-sunken text-muted"
        }
      >
        <ProviderIcon provider={provider.id} name={provider.name} width="18" height="18" />
      </span>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold">{provider.name}</h3>
        <p className="text-sm text-muted">{status}</p>
      </div>
      {children === undefined ? null : <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </div>
  );
}

function KeyLine({ source, envVar }: { source: "keychain" | "env"; envVar: string }) {
  return source === "env" ? (
    <span className="flex items-center gap-1.5">
      Key from <Code tone="muted">{envVar}</Code>
    </span>
  ) : (
    <span className="flex items-center gap-1.5">
      <LockIcon className="size-3.5" /> Key in the Keychain
    </span>
  );
}

/**
 * Settings › Models: the providers golem supports on the left, and on the right the one picked: its models with
 * stars, where its key is, and for Ollama its state, Get models and Settings. Keys are set in a terminal, so
 * nothing here takes one.
 */
export function ModelsView({ listing, keys, ollama, pulls, setup, actions, initial }: ModelsViewProps) {
  const [selected, setSelected] = useState(initial?.selected ?? ALL);
  const [sheet, setSheet] = useState<Sheet>(initial?.sheet ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => withActivePulls(listing, pulls), [listing, pulls]);
  const groups = useMemo(() => groupProviders(keys), [keys]);
  const usable = useMemo(() => usableModels(shown, keys), [shown, keys]);
  const starred = usable.filter(isStarred);
  const defaultName = shown?.default ?? null;
  const provider = providerEntry(selected);

  function pick(id: string): void {
    setSelected(id);
    setError(null);
  }

  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(actionErrorText(failure, fallback));
    } finally {
      setBusy(false);
    }
  }

  const onStar = (model: ListedModel): void => {
    void run(() => actions.star(model.ref, model.starred !== true), "Could not change the star.");
  };

  const errorLine =
    error === null ? null : (
      <p role="alert" className="text-sm text-deny">
        {error}
      </p>
    );

  let detail: ReactNode;
  if (selected === ALL || provider === undefined) {
    detail = (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">All starred models</h3>
        <p className="text-sm text-muted">{`What the composer's model menu lists: ${starred.length} of ${usable.length} models.`}</p>
        {errorLine}
        {starred.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">No model is starred. Star models on a provider to put them in the model menu.</p>
        ) : (
          <ModelTable label="All starred models" models={starred} defaultName={defaultName} showProvider pulls={pulls} busy={busy} onStar={onStar} />
        )}
      </div>
    );
  } else if (provider.kind === "later") {
    detail = (
      <div className="flex flex-col gap-3">
        <Head provider={provider} status="On this Mac · MLX models · not supported yet" />
        <div className="flex max-w-prose flex-col gap-2 rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">
          <p>
            <b className="font-semibold text-ink">golem can&apos;t use oMLX yet.</b> oMLX runs MLX models, which are often faster than Ollama&apos;s on Apple silicon.
          </p>
          <p>Support is planned.</p>
        </div>
      </div>
    );
  } else if (provider.kind === "mac") {
    detail = (
      <div className="flex flex-col gap-3">
        <Head provider={provider} status="On this Mac · golem manages it" />
        <OllamaPanel
          state={ollamaState(listing)}
          listing={shown}
          models={modelsOf(shown?.models ?? [], provider.id)}
          pulls={pulls}
          setup={setup}
          busy={busy}
          error={error}
          onStar={onStar}
          onRemove={(model) => {
            void run(() => actions.remove(model.ref), "Could not remove the model.");
          }}
          onStop={(model) => {
            void run(() => actions.stop(model.ref), "Could not stop the download.");
          }}
          onGetModels={() => {
            setSheet("get");
          }}
          onSettings={() => {
            setSheet("settings");
          }}
          initialRemoving={initial?.removing ?? null}
        />
      </div>
    );
  } else {
    const where = keyWhere(provider, keys);
    const models = modelsOf(shown?.models ?? [], provider.id);
    detail =
      where.source === null ? (
        <div className="flex flex-col gap-3">
          <Head provider={provider} status="Hosted · needs an API key" />
          <ProviderSetup provider={provider} envVar={where.envVar} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Head provider={provider} status={<KeyLine source={where.source} envVar={where.envVar} />}>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" kind="ghost" aria-label={`More for ${provider.name}`}>
                  <MoreIcon />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  onSelect={() => {
                    setSheet("key");
                  }}
                >
                  Replace or remove the key
                </MenuItem>
              </MenuContent>
            </Menu>
          </Head>
          <p className="text-sm text-muted">{`${models.filter(isStarred).length} of ${models.length} starred`}</p>
          {errorLine}
          {models.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">{`golem has not listed any ${provider.name} models yet. They show here once the provider answers.`}</p>
          ) : (
            <ModelTable label={`${provider.name} models`} models={models} defaultName={defaultName} pulls={pulls} busy={busy} onStar={onStar} />
          )}
        </div>
      );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row" data-setting="key">
      <div data-setting="provider" className="shrink-0 rounded-lg border border-line bg-sunken md:w-60">
        <ProviderList groups={groups} selected={selected} onSelect={pick} starredCount={starred.length} models={shown?.models ?? null} />
        <p className="border-t border-line px-3 py-2 text-meta text-faint">Keys are set in a terminal. This page never sees one.</p>
      </div>
      <div className="min-w-0 flex-1 pb-8">{detail}</div>
      <GetModelsSheet
        open={sheet === "get"}
        onOpenChange={(open) => {
          setSheet(open ? "get" : null);
        }}
        listing={shown}
        pulls={pulls}
        onPull={actions.pull}
        hf={actions.hf}
        {...(initial?.hf === undefined ? {} : { initialHf: initial.hf })}
        {...(initial?.tab === undefined ? {} : { initialTab: initial.tab })}
      />
      <OllamaSettingsSheet
        open={sheet === "settings"}
        onOpenChange={(open) => {
          setSheet(open ? "settings" : null);
        }}
        values={ollama}
        onSave={actions.saveOllama}
      />
      {provider === undefined || provider.kind !== "hosted" ? null : (
        <KeySheet
          provider={provider}
          where={keyWhere(provider, keys)}
          open={sheet === "key"}
          onOpenChange={(open) => {
            setSheet(open ? "key" : null);
          }}
        />
      )}
    </div>
  );
}
