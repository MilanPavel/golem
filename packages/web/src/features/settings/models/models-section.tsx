import { focusManager } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import { useKeys, useModelList, useOllamaSettings, usePageActions, usePulls } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { useSetupActions } from "../../setup/use-setup-actions.ts";
import { ModelsView, type ModelsActions } from "./models-view.tsx";

/**
 * Settings › Models. It reads `model.list` and `auth.list` again when the tab is seen, because a key set in a
 * terminal pushes no event: a provider moves from Not set up to Hosted by itself.
 */
export function ModelsSection() {
  // Show all is on: the table of a hosted provider lists every model it offers, so any of them can be starred.
  const listing = useModelList(true, true);
  const keys = useKeys();
  const ollama = useOllamaSettings();
  const pulls = usePulls();
  const page = usePageActions();
  const { refetch } = listing;
  const setup = useSetupActions(refetch);

  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) void refetch();
      }),
    [refetch],
  );

  const actions = useMemo<ModelsActions>(
    () => ({
      star: (ref, starred) => page.starModel(ref, starred),
      remove: (ref) => page.remove(ref),
      stop: (ref) => page.cancelPull(ref),
      pull: (ref) => page.pull(ref),
      hf: { search: (query) => page.searchHf(query), files: (repo) => page.hfFiles(repo) },
      library: { search: (query) => page.ollamaLibrary(query) },
      saveOllama: (params) => page.setOllamaSettings(params),
    }),
    [page],
  );

  if (keys.isError || (listing.isError && listing.data === undefined)) {
    const error = keys.isError ? keys.error : listing.error;
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(error, "Could not read the models.")}
        </p>
        <Button
          size="sm"
          onClick={() => {
            void keys.refetch();
            void refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (keys.data === undefined || listing.data === undefined) {
    return <p className="text-body text-muted">asking the daemon…</p>;
  }
  return <ModelsView listing={listing.data} keys={keys.data.providers} ollama={ollama.data ?? null} pulls={pulls} setup={setup} actions={actions} />;
}
