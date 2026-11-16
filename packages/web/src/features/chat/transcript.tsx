import { BUILD_TEXT, canTryStronger, lastQuestion, NO_STRONGER_NOTICE, STRONGER_ACTION, strongerLabel, helperLine, isDelegate, openPlan, displayToolName, formatTurnTime, groupTurns, turnFooterParts, stepCount, stepMark, summarizeSteps, turnFooter, LIVE_OUTPUT_CHARS, thinkingLine, unreadCallNotice, writingLabel, REPLY_CUT_NOTE, type ChatMessage, type ChatState, type Detail, type StepMark, type ToolBlock, type WritingBlock, noticesAfter, type ChatNotice, checksOf, checksSummary, turnRoutedNote, sessionModelOf, type SessionModelRef, rewoundLine, UNDO_WAIT } from "@golem/view";
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useConfig, usePageActions, usePulls, useSession, useModelList, useTurnCards } from "../../store/page-context.tsx";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { SessionModel } from "../../store/session-store.ts";
import { pullShare, shortName } from "../models/index.ts";
import { ApprovalChip } from "../approval/approval-chip.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import type { GolemState } from "../../ui/golem-state.ts";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { useDetail } from "./detail.ts";
import { useThinkingShown } from "./thinking-shown.ts";
import { useTimesShown } from "./times-shown.ts";
import { formatClock, shouldStick, squeezeArgs } from "./format.ts";
import type { DiffMode } from "../diff/diff-mode.ts";
import { DiffModeSwitch } from "../diff/diff-mode-switch.tsx";
import { useDiffMode } from "../diff/diff-mode.ts";
import { DiffView } from "../diff/diff-view.tsx";
import { activeComposer } from "../composer/active-composer.ts";
import { ChecksStrip } from "./checks-strip.tsx";
import { EditCards, isEditCard } from "./edit-card.tsx";
import { isPlanCard, PlanCard, type PlanActions } from "./plan-card.tsx";
import { Markdown } from "./markdown-view.tsx";
import { redoTargets, useUndo } from "../workbench/undo.tsx";

function ToolResult({ tool }: { tool: ToolBlock }) {
  switch (tool.status) {
    case "done":
      if (tool.unsuccessful === true) {
        return (
          <span className="whitespace-nowrap text-deny">
            <span aria-hidden="true">✗ </span>
            {tool.summary ?? "failed"}
          </span>
        );
      }
      return (
        <span className="whitespace-nowrap text-allow">
          <span aria-hidden="true">✓ </span>
          {tool.summary ?? "done"}
        </span>
      );
    case "failed":
      if (tool.approval?.answer?.decision === "deny") {
        return (
          <span className="whitespace-nowrap text-deny">
            <span aria-hidden="true">✗ </span>denied
          </span>
        );
      }
      return (
        <span className="max-w-xs truncate whitespace-nowrap text-deny" title={tool.error}>
          <span aria-hidden="true">✗ </span>
          {tool.error ?? "failed"}
        </span>
      );
    case "waiting":
      return <span className="whitespace-nowrap text-wait">waiting for you</span>;
    default:
      return <span className="whitespace-nowrap text-muted">running…</span>;
  }
}

const TABLET_TEXT = "max-h-80 overflow-auto whitespace-pre-wrap wrap-anywhere";

function Label({ children }: { children: string }) {
  return <p className="mb-1 text-faint">{children}</p>;
}

function ToolOutput({ tool, mode }: { tool: ToolBlock; mode: DiffMode }) {
  switch (tool.status) {
    case "running": {
      const output = tool.output ?? "";
      return (
        <section>
          <Label>output</Label>
          {output.length >= LIVE_OUTPUT_CHARS ? <p className="mb-1 text-faint">Earlier output is not shown.</p> : null}
          {output ? <pre className={TABLET_TEXT}>{output}</pre> : <p className="text-faint">no output yet</p>}
        </section>
      );
    }
    case "done":
      return (
        <section>
          <Label>output</Label>
          {tool.preview ? (
            tool.name === "git_diff" ? <DiffView diff={tool.preview} mode={mode} /> : <pre className={TABLET_TEXT}>{tool.preview}</pre>
          ) : (
            <p className="text-faint">no output</p>
          )}
          {tool.truncated ? <p className="mt-1 text-faint">The output was cut.</p> : null}
          {tool.artifactId ? <p className="mt-1 text-faint">The whole output is saved as artifact {tool.artifactId}.</p> : null}
        </section>
      );
    case "failed":
      return (
        <section>
          <Label>error</Label>
          <pre className={cn(TABLET_TEXT, "text-deny")}>{tool.error ?? "failed"}</pre>
        </section>
      );
    default:
      return null;
  }
}

/**
 * A `delegate` call as one line about its helper. Opened, it shows the helper's tool steps, indented
 * and drawn like any step, and then the helper's answer, which is the tool's result. In Quiet it is
 * only the line.
 */
function HelperLine({ tool, defaultOpen, quiet }: { tool: ToolBlock; defaultOpen: boolean; quiet: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const steps = tool.child?.toolSteps ?? [];
  const shown = open && !quiet;
  return (
    <li data-tool-status={tool.status} data-helper className="tool-line">
      <button
        type="button"
        aria-expanded={quiet ? undefined : shown}
        aria-controls={quiet ? undefined : bodyId}
        disabled={quiet}
        className="tool-line-head outline-offset-2 outline-clay focus-visible:outline-2"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true" className="tool-chevron text-faint">{quiet ? "" : "›"}</span>
        <span className="font-medium text-ink">{displayToolName(tool.name)}</span>
        <span className="truncate" title={helperLine(tool)}>{helperLine(tool)}</span>
      </button>
      {shown ? (
        <div id={bodyId} className="tool-tablet">
          {steps.length > 0 ? (
            <ul aria-label="Helper steps" className="mb-2 flex list-none flex-col gap-0.5 border-l border-line py-0.5 pl-3">
              {steps.map((step) => (
                <ToolLine key={step.callId} tool={step} defaultOpen={defaultOpen} />
              ))}
            </ul>
          ) : null}
          <ToolOutput tool={tool} mode="unified" />
        </div>
      ) : null}
    </li>
  );
}

/** One tool call as a line that opens into its tablet: the arguments and the output. The answered approval is a chip after the row. */
export function ToolLine({ tool, defaultOpen = false, pending = false, detail = "normal" }: { tool: ToolBlock; defaultOpen?: boolean; pending?: boolean; detail?: Detail }) {
  return isDelegate(tool) ? (
    <HelperLine tool={tool} defaultOpen={defaultOpen} quiet={detail === "quiet"} />
  ) : (
    <StepLine tool={tool} defaultOpen={defaultOpen} pending={pending} />
  );
}

function StepLine({ tool, defaultOpen, pending }: { tool: ToolBlock; defaultOpen: boolean; pending: boolean }) {
  const args = squeezeArgs(tool.args);
  const [open, setOpen] = useState(defaultOpen);
  const tabletId = useId();
  const [diffMode, setDiffMode] = useDiffMode();
  return (
    <li data-tool-status={tool.status} className="tool-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={tabletId}
        className="tool-line-head outline-offset-2 outline-clay focus-visible:outline-2"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true" className="tool-chevron text-faint">›</span>
        <span className="font-medium text-ink">{displayToolName(tool.name)}</span>
        <span className="truncate" title={args}>{args}</span>
        <ToolResult tool={tool} />
      </button>
      {tool.approval && !pending ? <ApprovalChip tool={tool} /> : null}
      {open ? (
        <div id={tabletId} className="tool-tablet">
          {tool.diff ? (
            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-faint">change</p>
                <DiffModeSwitch mode={diffMode} onChange={setDiffMode} />
              </div>
              <DiffView diff={tool.diff} mode={diffMode} />
            </section>
          ) : null}
          <section>
            <Label>arguments</Label>
            <pre className={TABLET_TEXT}>{JSON.stringify(tool.args, null, 2)}</pre>
          </section>
          <ToolOutput tool={tool} mode={diffMode} />
        </div>
      ) : null}
    </li>
  );
}

/** The line above an answer that came after thinking. It opens into the thinking text. */
export function ThinkingLine({ message, defaultOpen = false, shown }: { message: ChatMessage; defaultOpen?: boolean; shown?: boolean }) {
  const line = thinkingLine(message);
  const chosen = useThinkingShown();
  const [open, setOpen] = useState(defaultOpen);
  const textId = useId();
  if (line === null || !(shown ?? chosen)) return null;
  return (
    <div className="tool-line font-mono text-xs leading-snug" data-thinking>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={textId}
        className="tool-line-head outline-offset-2 outline-clay focus-visible:outline-2"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true" className="tool-chevron text-faint">›</span>
        <span>{line}</span>
      </button>
      {open ? (
        <div id={textId} role="region" aria-label="Thinking" className="tool-tablet">
          <pre className={cn(TABLET_TEXT, "text-muted")}>{message.thinking}</pre>
        </div>
      ) : null}
    </div>
  );
}

function golemState(steps: readonly ChatMessage[]): GolemState {
  if (steps.some((step) => step.tools?.some((tool) => tool.status === "waiting"))) return "waiting";
  return steps.some((step) => step.streaming) ? "thinking" : "idle";
}

export const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  const shown = useTimesShown();
  const time = shown ? formatClock(message.at) : "";
  return (
    <article aria-label="You" className="flex max-w-xl flex-col items-end self-end">
      <div className="min-w-0 rounded-lg rounded-br-xs bg-slip px-3.5 py-2.5 text-chat wrap-anywhere whitespace-pre-wrap">
        {message.skill ? (
          <span className="mb-1 block">
            <span className="inline-block rounded-full bg-clay-soft px-2 py-0.5 font-mono text-xs text-clay-ink">
              {message.skill.name}
            </span>
          </span>
        ) : null}
        {message.text}
      </div>
      {time ? <time dateTime={message.at} className="mt-1 font-mono text-xs text-muted">{time}</time> : null}
    </article>
  );
});

type Answering = {
  /** Overrides the `/thinking` choice, for the gallery. */
  thinkingShown?: boolean;
};

const GolemStep = memo(function GolemStep({ message, thinkingShown }: { message: ChatMessage } & Answering) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <ThinkingLine message={message} shown={thinkingShown} />
      {message.text ? (
        <div className="prose">
          <Markdown text={message.text} streaming={message.streaming} />
        </div>
      ) : null}
      {message.streaming ? <span aria-hidden="true" data-cursor className="transcript-cursor" /> : null}
      {message.interrupted ? <p className="font-mono text-xs text-muted">stopped</p> : null}
      {message.cut === true ? <p className="text-sm text-muted">{REPLY_CUT_NOTE}</p> : null}
    </div>
  );
});

const MARK_CLASS: Record<StepMark, string> = {
  allow: "bg-allow",
  deny: "bg-deny",
  wait: "rotate-45 rounded-xs bg-wait",
  run: "bg-muted",
};

/**
 * The file the model is still writing, where its tool line will appear. The seconds count from the
 * first `tool.writing` of the call: the row mounts then and goes when `tool.requested` clears it.
 */
export function WritingRow({ writing }: { writing: WritingBlock }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <p aria-live="off" data-writing className="flex items-center gap-2 font-mono text-xs leading-snug text-muted">
      <span aria-hidden="true" className="block size-1.5 shrink-0 animate-pulse rounded-full bg-wait motion-reduce:animate-none" />
      <span className="truncate">{writingLabel(writing, (now - started) / 1000)}</span>
    </p>
  );
}

/**
 * The tools of a whole turn as one line under the answer: a dot each and a summary. It opens into
 * the steps. A tool that waits for you keeps it open, and Verbose opens it with every row expanded. A tool
 * that had an approval shows how it ended as a chip; the one still waiting is asked in the dock instead.
 */
export function ActivityLine({ tools, detail, streaming = false, pendingId = null }: { tools: readonly ToolBlock[]; detail: Detail; streaming?: boolean; pendingId?: string | null }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const listId = useId();
  if (tools.length === 0) return null;
  // Outside Quiet a finished edit is a card above the line, not a row in it.
  const rows = detail === "quiet" ? tools : tools.filter((tool) => !isEditCard(tool));
  const verbose = detail === "verbose";
  const waiting = tools.some((tool) => tool.status === "waiting");
  const open = waiting || (chosen ?? verbose);
  const running = streaming ? tools.filter((tool) => tool.status === "running").at(-1) : undefined;
  const text =
    detail === "quiet"
      ? stepCount(tools.length)
      : running !== undefined
        ? `${displayToolName(running.name)} running…`
        : summarizeSteps(tools);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-activity>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        className="group -ml-1.5 inline-flex cursor-pointer items-center gap-2 self-start rounded-md px-1.5 py-0.5 text-xs text-muted outline-offset-2 outline-clay hover:bg-sunken hover:text-ink focus-visible:outline-2"
        onClick={() => {
          setChosen(!open);
        }}
      >
        <span aria-hidden="true" className="text-faint transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none">›</span>
        <span aria-hidden="true" className="inline-flex items-center gap-1">
          {tools.map((tool) => (
            <span key={tool.callId} data-mark={stepMark(tool)} className={cn("block size-1.5 rounded-full", MARK_CLASS[stepMark(tool)])} />
          ))}
        </span>
        <span>{text}</span>
      </button>
      {open && rows.length > 0 ? (
        <ul id={listId} aria-label="Tool calls" className="flex list-none flex-col gap-0.5 border-l border-line py-0.5 pl-3 font-mono text-xs leading-snug">
          {rows.map((tool) => (
            <ToolLine key={`${tool.callId}:${verbose}`} tool={tool} defaultOpen={verbose} pending={tool.callId === pendingId} detail={detail} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What golem did to keep the context small, as one muted line. The glyph is not the only signal: the words are. */
export function NoticeLine({ notice }: { notice: ChatNotice }) {
  return (
    <p role="note" data-notice={notice.action} className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden="true" className="text-faint">
        ⊖
      </span>
      <span>{notice.text}</span>
    </p>
  );
}

function TurnUndoLink({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? UNDO_WAIT : undefined}
      onClick={onClick}
      className="flex-none rounded-sm px-1 text-xs text-clay-ink underline outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** What a turn needs to offer undo: which runs changed files and were taken back, and the actions. */
export type TurnUndo = {
  /** By run id: the turns that changed files, with their file count and whether they were taken back. */
  turns: Readonly<Record<string, { files: number; reverted: boolean }>>;
  /** The run of the newest turn that changed files. Only it offers "Undo this turn". */
  latest: string | null;
  /** A run is active: nothing can be undone until it ends. */
  disabled: boolean;
  onUndo: (runId: string) => void;
  onRedo: (runId: string) => void;
};

/** The action at the end of the last answer's footer: send the question again one tier up. */
export type StrongerAction = { title: string; onClick: () => void };

/** One run: one golem, each model step in order, one activity line for all their tools, and one footer once the run is done. */
export function GolemTurn({
  steps,
  pendingId = null,
  thinkingShown,
  detail: detailOverride,
  plan,
  checks = null,
  notices = [],
  routedNote = "",
  undo,
  stronger,
}: { steps: readonly ChatMessage[]; pendingId?: string | null; thinkingShown?: boolean; detail?: Detail; plan?: PlanActions; checks?: ReturnType<typeof checksSummary> | null; notices?: readonly ChatNotice[]; routedNote?: string; undo?: TurnUndo; stronger?: StrongerAction }) {
  const chosenDetail = useDetail();
  const detail = detailOverride ?? chosenDetail;
  const footer = turnFooter(steps);
  const allTools = steps.flatMap((step) => step.tools ?? []);
  const runId = [...steps].reverse().find((step) => step.runId !== undefined)?.runId;
  const turnUndo = undo === undefined || runId === undefined ? undefined : undo.turns[runId];
  const reverted = turnUndo?.reverted === true;
  const planCards = allTools.filter(isPlanCard);
  const tools = allTools.filter((tool) => !isPlanCard(tool));
  const foot = footer
    ? [footer.durationMs === undefined ? "" : formatTurnTime(footer.durationMs), footer.tools > 0 ? stepCount(footer.tools) : "", ...turnFooterParts(footer, "", routedNote)].filter(Boolean)
    : [];
  return (
    <article aria-label="golem" className="flex min-w-0 flex-col gap-2.5">
      <PixelGolem state={golemState(steps)} size="sm" />
      {steps.map((message) => (
        <Fragment key={message.id}>
          <GolemStep message={message} thinkingShown={thinkingShown} />
          {noticesAfter(notices, message.id, detail === "quiet").map((notice) => (
            <NoticeLine key={notice.id} notice={notice} />
          ))}
        </Fragment>
      ))}
      {planCards.map((tool) => (
        <PlanCard key={tool.callId} tool={tool} plan={plan} />
      ))}
      {detail === "quiet" ? null : reverted ? (
        <div data-reverted="true" className="opacity-60">
          <EditCards tools={tools.filter(isEditCard)} />
        </div>
      ) : (
        <EditCards tools={tools.filter(isEditCard)} />
      )}
      {undo !== undefined && runId !== undefined && turnUndo !== undefined && !reverted && undo.latest === runId ? (
        <div className="flex flex-wrap items-start justify-between gap-x-3">
          <div className="min-w-0 flex-1">
            <ActivityLine tools={tools} detail={detail} streaming={steps.some((step) => step.streaming)} pendingId={pendingId} />
          </div>
          <TurnUndoLink disabled={undo.disabled} onClick={() => undo.onUndo(runId)}>
            Undo this turn
          </TurnUndoLink>
        </div>
      ) : (
        <ActivityLine tools={tools} detail={detail} streaming={steps.some((step) => step.streaming)} pendingId={pendingId} />
      )}
      {undo !== undefined && runId !== undefined && turnUndo !== undefined && reverted ? (
        <p data-rewound className="flex flex-wrap items-center gap-x-1 font-mono text-xs text-muted">
          <span>{rewoundLine(turnUndo.files)}</span>
          <span aria-hidden="true">·</span>
          <TurnUndoLink disabled={undo.disabled} onClick={() => undo.onRedo(runId)}>
            Redo
          </TurnUndoLink>
        </p>
      ) : null}
      {steps.map((step) => (step.writing == null ? null : <WritingRow key={step.id} writing={step.writing} />))}
      {checks === null ? null : <ChecksStrip {...checks} />}
      {foot.length > 0 || stronger !== undefined ? (
        <p className="font-mono text-xs text-faint">
          {foot.join(" · ")}
          {stronger === undefined ? null : (
            <>
              {foot.length > 0 ? " · " : ""}
              <button type="button" title={stronger.title} onClick={stronger.onClick} className="text-clay-ink hover:underline">
                {STRONGER_ACTION}
              </button>
            </>
          )}
        </p>
      ) : null}
    </article>
  );
}

/** What the transcript draws of the chat. `approval` names the call whose approval waits in the dock. */
export type TranscriptChat = Pick<ChatState, "messages" | "error" | "notice"> & Partial<Pick<ChatState, "approval" | "unreadCall" | "plan" | "checks" | "busy" | "runId" | "notices" | "route">>;

/** How a turn's checks went, or null when its run ran none. It is being fixed while that run goes on. */
function turnChecks(chat: TranscriptChat, steps: readonly ChatMessage[]): ReturnType<typeof checksSummary> | null {
  if (chat.checks === undefined) return null;
  const runId = [...steps].reverse().find((step) => step.runId !== undefined)?.runId;
  const turn = checksOf(chat.checks, runId);
  return turn === null ? null : checksSummary(turn, chat.busy === true && chat.runId === runId);
}

/** The messages and the closing error or notice. Pure: the page's stores are not read here. */
export function TranscriptMessages({ chat, thinkingShown, detail, waiting = null, plan, session = null, undo, stronger }: { session?: SessionModelRef | null; chat: TranscriptChat; thinkingShown?: boolean; detail?: Detail; waiting?: string | null; plan?: Omit<PlanActions, "open">; undo?: TurnUndo; stronger?: StrongerAction }) {
  const pendingId = chat.approval?.callId ?? null;
  const planActions: PlanActions | undefined =
    plan === undefined || chat.plan === undefined ? undefined : { ...plan, open: openPlan(chat.plan)?.callId ?? null };
  const chosenDetail = useDetail();
  const quiet = (detail ?? chosenDetail) === "quiet";
  const notices = chat.notices ?? [];
  const notice = chat.notice ?? (chat.unreadCall === true ? unreadCallNotice("web") : null);
  if (chat.messages.length === 0 && !chat.error && !notice) {
    return <p className="text-sm text-faint">No messages yet.</p>;
  }
  return (
    <>
      {noticesAfter(notices, null, quiet).map((item) => (
        <NoticeLine key={item.id} notice={item} />
      ))}
      {groupTurns(chat.messages).map((turn, index, turns) =>
        turn.kind === "user" ? (
          <Fragment key={turn.id}>
            <UserMessage message={turn.message} />
            {noticesAfter(notices, turn.id, quiet).map((item) => (
              <NoticeLine key={item.id} notice={item} />
            ))}
          </Fragment>
        ) : (
          <GolemTurn
            key={turn.id}
            steps={turn.steps}
            pendingId={pendingId}
            thinkingShown={thinkingShown}
            detail={detail}
            plan={planActions}
            checks={turnChecks(chat, turn.steps)}
            notices={notices}
            routedNote={turnRoutedNote(turn.steps, chat.route, session)}
            {...(undo === undefined ? {} : { undo })}
            {...(stronger === undefined || index !== turns.length - 1 ? {} : { stronger })}
          />
        ),
      )}
      {waiting === null ? null : <p role="status" className="font-mono text-xs text-muted">{waiting}</p>}
      {chat.error ? <p role="alert" className="text-sm text-deny">{chat.error}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted">{notice}</p> : null}
    </>
  );
}

/**
 * The scrolling column. While you are at the bottom it follows the text; once you scroll up it
 * stays where you are and offers a way back down.
 */
export function TranscriptColumn({ chat, className, waiting = null, plan, session = null, undo, stronger }: { session?: SessionModelRef | null; chat: TranscriptChat; className?: string; waiting?: string | null; plan?: Omit<PlanActions, "open">; undo?: TurnUndo; stronger?: StrongerAction }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = shouldStick(el.scrollTop, el.scrollHeight, el.clientHeight);
    stuck.current = near;
    setAtBottom(near);
  }, []);

  // New text, a new message, or a code block that grew: keep the end in view if it was in view.
  useLayoutEffect(() => {
    if (stuck.current) toBottom();
  }, [chat, toBottom]);

  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stuck.current) toBottom();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [toBottom]);

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto" data-transcript-scroller>
        <div ref={content} className="mx-auto flex max-w-column flex-col gap-8 px-5 py-7">
          <TranscriptMessages chat={chat} waiting={waiting} plan={plan} session={session} {...(undo === undefined ? {} : { undo })} {...(stronger === undefined ? {} : { stronger })} />
        </div>
      </div>
      {atBottom ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            size="sm"
            className="pointer-events-auto shadow-soft"
            onClick={() => {
              stuck.current = true;
              toBottom();
              setAtBottom(true);
            }}
          >
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

/** `waiting for qwen3:8b · 12%` while a message waits on the download of the session's model, else null. */
export function waitingLine(busy: boolean, model: SessionModel | null, pulls: PullsSnapshot): string | null {
  if (!busy || model === null || model.provider === null || model.name === null) return null;
  const ref = `${model.provider}/${model.name}`;
  const entry = pulls.active.get(ref);
  if (entry === undefined) return null;
  const share = pullShare(entry, null);
  return `waiting for ${shortName(ref)}${share === null ? "" : ` · ${Math.round(share * 100)}%`}`;
}

/** A session's transcript, read from the page's session store. The approval that waits is in the dock. */
export function Transcript({ id }: { id: string }) {
  const chat = useSession(id, (view) => view.chat);
  const model = useSession(id, (view) => view.model);
  const pulls = usePulls();
  // The tier of the session's model comes from the listing, read only once a turn has been routed.
  const models = useModelList(chat.route.last !== null);
  const session = sessionModelOf({ profile: model?.profile ?? null, provider: model?.provider ?? null, name: model?.name ?? null }, models.data?.models);
  const actions = usePageActions();
  const plan = {
    // "Build it" takes plan first off, then sends the build message like any other.
    onBuild: async () => {
      await actions.setPlan(id, false);
      await activeComposer()?.run(BUILD_TEXT);
    },
    onChange: () => activeComposer()?.focus(),
  };
  const cards = useTurnCards(id);
  const undo = useUndo(id);
  const turnUndo: TurnUndo = {
    turns: Object.fromEntries(cards.map((card) => [card.runId, { files: card.files.length, reverted: card.reverted }])),
    latest: cards[0]?.runId ?? null,
    disabled: undo.disabled,
    onUndo: (runId) => {
      undo.rewind(cards, runId);
    },
    onRedo: (runId) => {
      const card = cards.find((item) => item.runId === runId);
      if (card !== undefined) undo.ask(redoTargets(card));
    },
  };
  const cwd = useSession(id, (view) => view.cwd);
  const routed = chat.route.last !== null;
  const config = useConfig(cwd, id, routed);
  const [failure, setFailure] = useState<string | null>(null);
  const question = lastQuestion(chat.messages);
  const title = strongerLabel(models.data?.models ?? [], config.data?.routing, chat.route.last);
  const offered = canTryStronger({ mode: chat.route.mode, idle: !chat.busy, models: models.data?.models ?? [], routing: config.data?.routing, last: chat.route.last });
  const stronger: StrongerAction | undefined =
    offered && question !== null && title !== null
      ? {
          title,
          onClick: () => {
            setFailure(null);
            actions.sendStronger(id, question).catch((error: unknown) => {
              setFailure(error instanceof Error && error.message !== "" ? error.message : NO_STRONGER_NOTICE);
            });
          },
        }
      : undefined;
  return (
    <>
      <TranscriptColumn chat={failure === null ? chat : { ...chat, error: failure }} waiting={waitingLine(chat.busy, model, pulls)} plan={plan} session={session} undo={turnUndo} {...(stronger === undefined ? {} : { stronger })} />
      {undo.dialogs}
    </>
  );
}
