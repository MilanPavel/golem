import { daemonServiceRow, golemBlock, HOSTED_PROVIDERS, pageServiceRow, setupFormRows, setupProblem, setupProblemState, toolsSettled, type FormButtonId, type Mark } from "@golem/view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useModelList, useNavigate, usePageHost, useSetupStatus } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { openModelDialog } from "../models/index.ts";
import { GolemBlockView } from "../setup/golem-block.tsx";
import { AddKey, SetupFormView, SetupHeader } from "../setup/setup-form.tsx";
import { ToolsOfferView } from "../setup/tools-offer.tsx";
import { useSetupActions } from "../setup/use-setup-actions.ts";
import { useTools } from "../setup/use-tools.ts";
import { welcomePath } from "../../store/router.ts";
import { SECTIONS } from "./sections.ts";

/** A link of the form points at `/settings/<section>`: it is shown once the page has that section. */
function hasPage(path: string): boolean {
  const section = path.replace(/^\/settings\//, "");
  return path.startsWith("/settings/") && SECTIONS.some((item) => item.id === section);
}

const HEAD_MARKS: Record<"ok" | "warn" | "fail", Mark> = { ok: "ok", warn: "attn", fail: "fail" };

/** The Tools offer of Settings → Setup, in place under the cards. The status is read again once the servers are added. */
function AddTools({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const tools = useTools({ mode: "single", enabled: true });
  const settled = tools.state !== null && toolsSettled(tools.state);
  useEffect(() => {
    if (settled) onAdded();
  }, [settled, onAdded]);
  if (tools.state === null) {
    return (
      <p role={tools.failed ? "alert" : "status"} className={tools.failed ? "text-sm text-deny" : "text-sm text-muted"}>
        {tools.failed ? "Could not read the starter tools." : "Checking…"}
      </p>
    );
  }
  return (
    <div role="group" aria-label="Add tools" className="rounded-lg border border-line bg-surface p-4">
      <ToolsOfferView
        state={tools.state}
        draft={tools.draft}
        logs={tools.logs}
        onDraft={tools.setDraft}
        onTick={tools.tick}
        onStart={() => {
          if (!tools.start()) onClose();
        }}
        onSkip={onClose}
        onContinue={onClose}
        onRetry={tools.retry}
        onSkipRow={tools.skipRow}
        onLog={tools.showLog}
      />
    </div>
  );
}

/**
 * Settings → Setup: the golem block, then each part of setup as a row with its fix on the right. It reads `setup.status`
 * again when it opens and whenever the tab is seen again, because a key set in a terminal pushes
 * no event.
 */
export function SetupSection() {
  const status = useSetupStatus();
  const listing = useModelList(true);
  const connection = useConnection();
  const pageHost = usePageHost();
  const navigate = useNavigate();
  const { refetch } = status;
  const actions = useSetupActions(refetch);
  const [adding, setAdding] = useState(false);
  const reread = useCallback((): void => {
    void refetch();
  }, [refetch]);
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const sourceRows = status.isError ? null : (status.data?.rows ?? null);
  const form = useMemo(
    () =>
      sourceRows === null
        ? null
        : setupFormRows(sourceRows, pageServiceRow(daemonServiceRow(sourceRows), connection.daemonVersion ?? ""), pageHost.kept),
    [sourceRows, connection.daemonVersion, pageHost.kept],
  );
  const line = sourceRows === null ? null : (setupProblem(sourceRows) ?? "all set");
  const headMark: Mark = sourceRows === null ? "spin" : HEAD_MARKS[setupProblemState(sourceRows)];
  const block = useMemo(() => (status.data === undefined || status.isError ? null : golemBlock(status.data)), [status.data, status.isError]);
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
      case "add_tools":
        setAdding(true);
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
    <div className="flex flex-col gap-3">
      <SetupHeader
        mark={headMark}
        text={line === null ? "Checking…" : line.charAt(0).toUpperCase() + line.slice(1)}
        onRunAgain={() => {
          navigate(welcomePath());
        }}
      />
      {block === null ? null : <GolemBlockView block={block} />}
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
          {adding ? (
            <AddTools
              onClose={() => {
                setAdding(false);
              }}
              onAdded={reread}
            />
          ) : null}
          <AddKey
            providers={listing.data === undefined ? [] : keyProviders}
            actions={actions.state}
            onCheck={() => {
              actions.checkAgain("key");
            }}
          />
        </>
      )}
    </div>
  );
}
