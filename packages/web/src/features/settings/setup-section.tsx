import { daemonServiceRow, guided, HOSTED_PROVIDERS, pageServiceRow, setupFormRows, setupProblem, type FormButtonId } from "@golem/view";
import { useEffect, useMemo } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useModelList, useNavigate, useSetupStatus } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { openModelDialog } from "../models/index.ts";
import { openSetup } from "../setup/index.ts";
import { AddKey, SetupFormView } from "../setup/setup-form.tsx";
import { useSetupActions } from "../setup/use-setup-actions.ts";
import { SECTIONS } from "./sections.ts";

/** A link of the form points at `/settings/<section>`: it is shown once the page has that section. */
function hasPage(path: string): boolean {
  const section = path.replace(/^\/settings\//, "");
  return path.startsWith("/settings/") && SECTIONS.some((item) => item.id === section);
}

/**
 * Settings → Setup: each part of setup as a card with its fix beside it. It reads `setup.status`
 * again when it opens and whenever the tab is seen again, because a key set in a terminal pushes
 * no event.
 */
export function SetupSection() {
  const status = useSetupStatus();
  const listing = useModelList(true);
  const connection = useConnection();
  const navigate = useNavigate();
  const { refetch } = status;
  const actions = useSetupActions(refetch);
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const sourceRows = status.isError ? null : (status.data?.rows ?? null);
  const form = useMemo(
    () =>
      sourceRows === null
        ? null
        : setupFormRows(sourceRows, pageServiceRow(daemonServiceRow(sourceRows), connection.daemonVersion ?? "")),
    [sourceRows, connection.daemonVersion],
  );
  const line = sourceRows === null ? null : (setupProblem(sourceRows) ?? "all set");
  const saved = new Set(listing.data?.setup.keys ?? []);
  const keyProviders = HOSTED_PROVIDERS.map((item) => ({ id: item.id, name: item.name, blurb: item.blurb, saved: saved.has(item.id) }));

  function press(id: FormButtonId, card: string, from: HTMLElement): void {
    switch (id) {
      case "install_ollama":
        actions.install();
        return;
      case "start_ollama":
        actions.start();
        return;
      case "check_again":
        actions.checkAgain(card);
        return;
      case "change_model":
        openModelDialog({ sessionId: null, mode: "default", returnTo: from });
        return;
    }
  }

  if (status.isError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4">
        <p role="alert" className="text-sm text-deny">
          Could not read the setup: {status.error.message}
        </p>
        <Button
          size="sm"
          onClick={() => {
            void refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="font-mono text-sm text-muted">
        {line ?? "checking…"}
      </p>
      {form === null ? null : (
        <>
          <SetupFormView
            rows={form}
            actions={actions.state}
            onButton={press}
            onCancelInstall={actions.cancelInstall}
            onNavigate={navigate}
            hasPage={hasPage}
          />
          <AddKey
            providers={listing.data === undefined ? [] : keyProviders}
            actions={actions.state}
            onCheck={() => {
              actions.checkAgain("key");
            }}
          />
          <div className="flex flex-col items-start gap-1">
            <Button
              onClick={(event) => {
                openSetup({ window: guided("service", "overview"), returnTo: event.currentTarget });
              }}
            >
              Run setup again
            </Button>
            <p className="text-sm text-muted">Walk through the service, the engine, and the model from the start.</p>
          </div>
        </>
      )}
    </div>
  );
}
