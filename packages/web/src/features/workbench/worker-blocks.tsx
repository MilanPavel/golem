import { applyGreenLabel, copiesFooter, greenCount, workerBlocks, workerDiffStat, type WorkerAction, type WorkerBlock, type WorkerStatus } from "@golem/view";
import { useMemo, useState } from "react";
import { actionErrorText, helperConflictPath } from "../../store/errors.ts";
import { useAgentList, useArtifact, usePageActions, useSession } from "../../store/page-context.tsx";
import { Badge, type BadgeProps } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { useDiffMode } from "../diff/index.ts";
import { DiffPanel, plural } from "./file-row.tsx";
import { useWorkbenchWidth } from "./workbench-width.ts";

/** From this panel width, in rem, a diff may be shown side by side. Narrower, it is unified. */
const SPLIT_MIN_WIDTH = 40;

const STATUS: Record<WorkerStatus, { word: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  running: { word: "Working", tone: "wait" },
  green: { word: "Checks pass", tone: "allow" },
  failed: { word: "Checks fail", tone: "deny" },
  stopped: { word: "Stopped", tone: "deny" },
  applied: { word: "Applied", tone: "neutral" },
  discarded: { word: "Discarded", tone: "neutral" },
};

/** The line for a worker whose file changed in the project after the worker copied it. */
export function conflictLine(path: string): string {
  return `${path} changed since the worker copied it`;
}

type BlockAction = Exclude<WorkerAction, "view">;

const ACTION_WORDS: Record<BlockAction, string> = { apply: "Apply", retry: "Try again, stronger", discard: "Discard" };

/** The diff of a worker, read from its artifact a page at a time, in the diff view of the Changes tab. */
function WorkerDiff({ sessionId, artifactId }: { sessionId: string; artifactId: string }) {
  const query = useArtifact(sessionId, artifactId);
  const [mode, setMode] = useDiffMode();
  const [width] = useWorkbenchWidth();
  const text = query.data === undefined ? null : query.data.pages.map((page) => page.text).join("");
  return (
    <div className="mt-2">
      <DiffPanel
        diff={{ diff: text, truncated: false, error: query.isError ? query.error.message : null }}
        mode={mode}
        onMode={setMode}
        canSplit={width >= SPLIT_MIN_WIDTH}
      />
      {query.hasNextPage ? (
        <Button size="sm" className="mt-2" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}

type BlockProps = {
  sessionId: string;
  block: WorkerBlock;
  /** A line under the block: a conflict, or why a call failed. */
  note: string | null;
  busy: boolean;
  onAction: (action: BlockAction) => void;
};

function Block({ sessionId, block, note, busy, onAction }: BlockProps) {
  const [viewing, setViewing] = useState(false);
  const status = STATUS[block.status];
  const done = block.status === "applied" || block.status === "discarded";
  return (
    <li data-helper={block.helperId} data-status={block.status} className={cn("flex min-w-0 flex-col gap-1 rounded-md border border-line bg-surface p-3", done && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{block.label}</span>
        <Badge tone={status.tone}>{status.word}</Badge>
        {block.files.length === 0 ? null : (
          <span className="flex items-center gap-2 text-meta text-muted">
            <span>{plural(block.files.length, "file")}</span>
            <span className="tabular-nums">{workerDiffStat(block)}</span>
          </span>
        )}
      </div>
      {block.checksLine === "" ? null : <p className="text-meta text-muted">{block.checksLine}</p>}
      {block.actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-2 pt-1">
          {block.actions.map((action) =>
            action === "view" ? (
              <Button
                key={action}
                size="sm"
                disabled={block.diffArtifactId === null}
                aria-expanded={viewing}
                onClick={() => {
                  setViewing(!viewing);
                }}
              >
                View
              </Button>
            ) : (
              <Button
                key={action}
                size="sm"
                kind={action === "apply" ? "primary" : action === "discard" ? "danger" : "secondary"}
                disabled={busy}
                onClick={() => {
                  onAction(action);
                }}
              >
                {ACTION_WORDS[action]}
              </Button>
            ),
          )}
        </div>
      )}
      {note === null ? null : (
        <p role="alert" className="text-meta text-deny">
          {note}
        </p>
      )}
      {viewing && block.diffArtifactId !== null ? <WorkerDiff sessionId={sessionId} artifactId={block.diffArtifactId} /> : null}
    </li>
  );
}

type WorkerBlocksViewProps = {
  sessionId: string;
  blocks: readonly WorkerBlock[];
  folder: string;
  /** What each block says under it, by helper id. */
  notes: Readonly<Record<string, string>>;
  /** The helper ids with a call in flight. */
  busy: ReadonlySet<string>;
  onAction: (block: WorkerBlock, action: BlockAction) => void;
  onApplyGreen: () => void;
};

/** The blocks and their footer. It calls nothing. Nothing is drawn for no blocks. */
export function WorkerBlocksView({ sessionId, blocks, folder, notes, busy, onAction, onApplyGreen }: WorkerBlocksViewProps) {
  if (blocks.length === 0) return null;
  const footer = copiesFooter(blocks, folder);
  const green = applyGreenLabel(greenCount(blocks));
  return (
    <section aria-label="Workers" className="flex min-w-0 flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {blocks.map((block) => (
          <Block
            key={block.helperId}
            sessionId={sessionId}
            block={block}
            note={notes[block.helperId] ?? null}
            busy={busy.has(block.helperId)}
            onAction={(action) => {
              onAction(block, action);
            }}
          />
        ))}
      </ul>
      {footer === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-meta text-muted">{footer}</p>
          {green === null ? null : (
            <Button size="sm" kind="primary" disabled={busy.size > 0} onClick={onApplyGreen}>
              {green}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** The worker blocks of a session, above the turn cards of the Changes tab: one per worker, read from the lead's log. */
export function WorkerBlocks({ sessionId }: { sessionId: string }) {
  const actions = usePageActions();
  const log = useSession(sessionId, (view) => view.workerLog);
  const cwd = useSession(sessionId, (view) => view.cwd);
  const agents = useAgentList(cwd, log.length > 0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  // A running helper is a worker when its agent type changes things. Without the list only ended workers show.
  const writing = useMemo(() => {
    const names = new Set<string>();
    for (const info of agents.data?.agents ?? []) {
      if ((info.changing_tools ?? []).length > 0) names.add(info.name);
    }
    return names;
  }, [agents.data]);
  const blocks = useMemo(() => workerBlocks(log, { writes: (agent) => writing.has(agent) }), [log, writing]);

  function setNote(helperId: string, note: string | null): void {
    setNotes((now) => {
      const next = { ...now };
      if (note === null) delete next[helperId];
      else next[helperId] = note;
      return next;
    });
  }
  function setWorking(helperId: string, working: boolean): void {
    setBusy((now) => {
      const next = new Set(now);
      if (working) next.add(helperId);
      else next.delete(helperId);
      return next;
    });
  }

  /** Applies one worker. False when it did not go in: a conflict, or a failed call. */
  async function applyOne(block: WorkerBlock): Promise<boolean> {
    setNote(block.helperId, null);
    setWorking(block.helperId, true);
    try {
      await actions.applyHelper(sessionId, block.helperId);
      return true;
    } catch (failure) {
      const path = helperConflictPath(failure);
      if (path === null) setNote(block.helperId, actionErrorText(failure, "Could not apply."));
      else setNote(block.helperId, path === "" ? "A file changed since the worker copied it" : conflictLine(path));
      return false;
    } finally {
      setWorking(block.helperId, false);
    }
  }

  async function other(block: WorkerBlock, action: "retry" | "discard"): Promise<void> {
    setNote(block.helperId, null);
    setWorking(block.helperId, true);
    try {
      if (action === "retry") await actions.retryHelper(sessionId, block.helperId);
      else await actions.discardHelper(sessionId, block.helperId);
    } catch (failure) {
      setNote(block.helperId, actionErrorText(failure, action === "retry" ? "Could not start it again." : "Could not discard."));
    } finally {
      setWorking(block.helperId, false);
    }
  }

  async function applyGreen(): Promise<void> {
    for (const block of blocks.filter((item) => item.status === "green")) {
      if (!(await applyOne(block))) return;
    }
  }

  return (
    <WorkerBlocksView
      sessionId={sessionId}
      blocks={blocks}
      folder={cwd ?? "the folder"}
      notes={notes}
      busy={busy}
      onAction={(block, action) => {
        if (action === "apply") void applyOne(block);
        else void other(block, action);
      }}
      onApplyGreen={() => void applyGreen()}
    />
  );
}
