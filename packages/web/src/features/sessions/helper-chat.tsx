import {
  formatElapsed,
  helperBanner,
  helperLimits,
  helperPanelState,
  helperReceipt,
  isTrimmedHelper,
  helperSummary,
  helperWorkingMs,
  type ApprovalChoice,
  type ChatState,
  type ConsentChoice,
  type HelperRef,
  type HelperState,
  type ToolBlock,
} from "@golem/view";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePageActions, useNavigate, useSession, useSessionList } from "../../store/page-context.tsx";
import { sendErrorText } from "../../store/errors.ts";
import { helperPath, sessionPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { HEADER_ROW } from "../../ui/header-row.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import type { GolemState } from "../../ui/golem-state.ts";
import { ResizeHandle } from "../../ui/resize-handle.tsx";
import { StatusDot } from "../../ui/status-dot.tsx";
import { ApprovalBar, useApprovalAnswer } from "../approval/index.ts";
import { closeHelper, openHelper, TranscriptColumn, type HelperOpen } from "../chat/index.ts";
import { ConsentBar } from "../consent/consent-bar.tsx";
import { WORKBENCH_DEFAULT, WORKBENCH_MAX, WORKBENCH_MIN, WORKBENCH_STEP, useWorkbenchWidth } from "../workbench/index.ts";
import { HelperBannerBar, HelperReceiptCard } from "./helper-receipt.tsx";
import { useNow } from "./use-now.ts";

export type HelperView = "summary" | "everything";

const VIEWS: readonly { id: HelperView; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "everything", label: "Everything" },
];

const DOT: Record<HelperState, GolemState> = {
  queued: "idle",
  running: "thinking",
  waiting: "waiting",
  done: "idle",
  failed: "failed",
  stopped: "waiting",
};

/** The first words of the brief, for the head. */
function firstWords(text: string | null, count = 7): string {
  if (text === null) return "starting";
  const words = text.split(/\s+/).filter((word) => word !== "");
  return words.length <= count ? words.join(" ") : `${words.slice(0, count).join(" ")}…`;
}

const LABEL = "text-meta text-faint";

/** The two-way switch: Summary or Everything. The arrows move between them. */
function ViewSwitch({ view, onView }: { view: HelperView; onView: (view: HelperView) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = VIEWS[(index + step + VIEWS.length) % VIEWS.length];
    if (next === undefined) return;
    onView(next.id);
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[VIEWS.indexOf(next)]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label="Helper view" className="flex gap-1">
      {VIEWS.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={view === item.id}
          tabIndex={view === item.id ? 0 : -1}
          className="cursor-pointer rounded-sm border border-line-strong bg-surface px-2.5 py-1 text-xs outline-offset-2 outline-clay focus-visible:outline-2 aria-checked:bg-clay-soft aria-checked:text-clay-ink"
          onClick={() => {
            onView(item.id);
          }}
          onKeyDown={(event) => {
            move(event, index);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export type HelperPanelViewProps = {
  /** The lead's title, for `helper of "…"`. */
  lead: string | null;
  helper: HelperRef;
  chat: ChatState;
  nowMs: number;
  view: HelperView;
  onView: (view: HelperView) => void;
  onClose: () => void;
  /** Steps to the next helper of the batch. Null when there is only one. */
  onNext: (() => void) | null;
  /** Stops the helper. Null once it ended. */
  onStop: (() => void) | null;
  onOpenChat: () => void;
  /** The answer controls of a helper that asks: the approval or consent card. */
  answer?: ReactNode;
  /** When the daemon trimmed this helper to its receipt: the body shows the receipt, not the steps. */
  trimmedAt?: string | null;
};

/**
 * One helper in the drawer, read-only: its head, the switch between Summary and Everything, its question
 * if it asks, the body, and the foot. There is no composer; the lead is the one who talks to it.
 */
export function HelperPanelView({ lead, helper, chat, nowMs, view, onView, onClose, onNext, onStop, onOpenChat, answer, trimmedAt = null }: HelperPanelViewProps) {
  const trimmed = trimmedAt !== null;
  const summary = helperSummary(chat);
  const state = helperPanelState(helper, chat);
  const working = helperWorkingMs(helper, nowMs);
  const local = helper.ended !== null && helper.ended.costUsd === 0 ? true : null;
  const limits = helperLimits(helper, chat, nowMs, local);
  const kind = helper.label !== "" ? helper.label : helper.agent;
  const sub = [lead === null ? "helper of the chat" : `helper of "${lead}"`, helper.model, working === null ? null : formatElapsed(working)];
  return (
    <section aria-label="Helper" data-helper-panel className="flex min-h-0 flex-1 flex-col">
      <header className={cn(HEADER_ROW, "min-h-0 flex-col items-stretch gap-0.5 px-3 py-2")}>
        <div className="flex items-center gap-2">
          <StatusDot state={DOT[state]} />
          <h2 className="flex-none text-sm font-medium">{kind}</h2>
          <p className="min-w-0 flex-1 truncate text-sm text-muted" title={summary.brief ?? undefined}>
            {firstWords(summary.brief)}
          </p>
          <IconButton label="Close helper" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <p className="truncate text-xs text-muted">{sub.filter((part): part is string => part !== null).join(" · ")}</p>
      </header>
      {trimmed ? null : (
        <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2">
          <ViewSwitch view={view} onView={onView} />
          {limits === "" ? null : (
            <p aria-label="Limits" className="text-meta text-faint">
              {limits}
            </p>
          )}
        </div>
      )}
      {summary.question === null || trimmed ? null : (
        <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
          <p className={LABEL}>asks you</p>
          <p className="text-sm text-pretty">{summary.question}</p>
          {answer}
        </div>
      )}
      {trimmed ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <HelperReceiptCard receipt={helperReceipt({ ref: helper, chat, trimmedAt })} />
        </div>
      ) : view === "everything" ? (
        <TranscriptColumn chat={chat} detail="verbose" thinkingShown />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {summary.brief === null ? null : (
            <section aria-label="Brief">
              <p className={LABEL}>brief</p>
              <p className="text-sm text-pretty whitespace-pre-wrap">{summary.brief}</p>
            </section>
          )}
          {summary.calls === null ? null : <p className="text-sm text-muted">{summary.calls}</p>}
          {summary.latest === null ? null : (
            <section aria-label="Now">
              <p className={LABEL}>now</p>
              <p className="text-sm text-pretty">{summary.latest}</p>
            </section>
          )}
          {summary.answer === null ? null : (
            <section aria-label="Answer to the lead">
              <p className={LABEL}>answer to the lead</p>
              <p className="text-sm text-pretty whitespace-pre-wrap">{summary.answer}</p>
            </section>
          )}
          {summary.hidden === null ? null : <p className="text-xs text-faint">{summary.hidden}</p>}
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        {onNext === null ? null : (
          <Button size="sm" onClick={onNext}>
            Next helper
          </Button>
        )}
        {onStop === null ? null : (
          <Button size="sm" kind="danger" onClick={onStop}>
            Stop
          </Button>
        )}
        <Button size="sm" kind="ghost" className="ml-auto" onClick={onOpenChat}>
          Open as chat
        </Button>
      </footer>
    </section>
  );
}

/** The waiting call of a helper's own log, for the approval card. */
function waitingTool(chat: ChatState): ToolBlock | null {
  const callId = chat.approval?.callId;
  if (callId === undefined) return null;
  for (const message of chat.messages) {
    const tool = message.tools?.find((item) => item.callId === callId);
    if (tool?.approval !== undefined) return tool;
  }
  return null;
}

/**
 * The answer buttons of a helper that asks. They answer for the helper's own session, through the same
 * calls the lead's dock uses. No keys are bound here, so the lead's own question keeps its keys.
 */
function HelperAnswer({ sessionId, chat }: { sessionId: string; chat: ChatState }) {
  const { respond, answerConsent } = usePageActions();
  const tool = waitingTool(chat);
  const callId = tool?.callId ?? null;
  const { answer, sendingId, error } = useApprovalAnswer(
    (call: string, decision: ApprovalChoice, args?: Readonly<Record<string, unknown>>) =>
      args === undefined ? respond(sessionId, call, decision) : respond(sessionId, call, decision, args),
    callId,
  );
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const consent = chat.consent;
  if (tool !== null && callId !== null) {
    return (
      <ApprovalBar
        key={callId}
        tool={tool}
        sending={sendingId === callId}
        error={error}
        editing={editing}
        onEdit={setEditing}
        onAnswer={(decision, args) => {
          if (args === undefined) answer(callId, decision);
          else answer(callId, decision, args);
        }}
      />
    );
  }
  if (consent === null) return null;
  return (
    <ConsentBar
      key={consent.runId}
      consent={consent}
      sending={sent === consent.runId}
      error={failed}
      onAnswer={(choice: ConsentChoice) => {
        setSent(consent.runId);
        setFailed(null);
        answerConsent(sessionId, consent.runId, choice).catch((err: unknown) => {
          setSent(null);
          setFailed(sendErrorText(err));
        });
      }}
    />
  );
}

/** The lead's title: its own once it has one, the list's before that. */
function useLeadTitle(leadId: string): string | null {
  const own = useSession(leadId, (view) => view.title);
  const listed = useSessionList().find((item) => item.session_id === leadId)?.title;
  return own ?? listed ?? null;
}

/** When the daemon trimmed this helper, from the session list. Null for a helper that is whole, and for an older daemon. */
function useTrimmedAt(helperId: string): string | null {
  const listed = useSessionList().find((item) => item.session_id === helperId);
  return listed !== undefined && isTrimmedHelper(listed) ? (listed.trimmed_at ?? null) : null;
}

const NO_HELPERS: readonly HelperRef[] = [];

type Batch = { callId: string | null; helpers: readonly HelperRef[] };
const NO_BATCH: Batch = { callId: null, helpers: NO_HELPERS };

/**
 * The helpers of one `delegate` call of the lead, from the lead's own log. With no call id (opened from
 * the sidebar), the call is the one that has the helper, found once the lead's chat has loaded.
 */
function useBatch(leadId: string, callId: string | undefined, helperId: string): Batch {
  const found = useSession(leadId, (view) => {
    for (const message of view.chat.messages) {
      for (const tool of message.tools ?? []) {
        const helpers = tool.child?.helpers;
        if (helpers === undefined) continue;
        if (callId !== undefined ? tool.callId === callId : helpers.some((item) => item.id === helperId)) return tool;
      }
    }
    return null;
  });
  return found === null ? NO_BATCH : { callId: found.callId, helpers: found.child?.helpers ?? NO_HELPERS };
}

/**
 * A helper beside the lead's chat, in the right drawer. It attaches to the helper's session while it is
 * open and detaches when it closes. Escape inside it closes it; Next helper steps through the batch.
 */
export function HelperPanel({ leadId, open }: { leadId: string; open: HelperOpen }) {
  const { callId, helpers: batch } = useBatch(leadId, open.callId, open.helperId);
  const helper = batch.find((item) => item.id === open.helperId);
  const lead = useLeadTitle(leadId);
  const chat = useSession(open.helperId, (view) => view.chat);
  const trimmedAt = useTrimmedAt(open.helperId);
  const { stopHelper } = usePageActions();
  const navigate = useNavigate();
  const now = useNow(5_000);
  const [view, setView] = useState<HelperView>("summary");
  const [width, setWidth] = useWorkbenchWidth();
  const panel = useRef<HTMLElement>(null);
  // Focus comes into the panel, so that Escape closes it.
  useEffect(() => {
    panel.current?.focus();
  }, []);
  if (helper === undefined) return null;
  const state = helperPanelState(helper, chat);
  const index = batch.indexOf(helper);
  const next = batch.length > 1 ? batch[(index + 1) % batch.length] : undefined;
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label="Helper panel"
      onKeyDown={(event) => {
        // Not for a key that came through a dialog's portal, which Radix closes on its own.
        if (event.key === "Escape" && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) closeHelper();
      }}
      style={width === WORKBENCH_DEFAULT ? undefined : { width: `${width}rem` }}
      className="fixed inset-y-0 right-0 z-20 flex min-h-0 w-80 max-w-11/12 flex-col border-l border-line bg-surface shadow-soft outline-none wide:relative wide:z-auto wide:max-w-3/5 wide:flex-none wide:shadow-none"
    >
      <ResizeHandle
        width={width}
        min={WORKBENCH_MIN}
        max={WORKBENCH_MAX}
        step={WORKBENCH_STEP}
        label="Resize the helper"
        onResize={setWidth}
        panel={panel}
        className="max-wide:hidden"
      />
      <HelperPanelView
        lead={lead}
        helper={helper}
        chat={chat}
        nowMs={now}
        view={view}
        onView={setView}
        onClose={closeHelper}
        onNext={next === undefined || callId === null ? null : () => openHelper({ callId, helperId: next.id })}
        onStop={
          state === "running" || state === "waiting"
            ? () => {
                stopHelper(helper.id).catch(() => undefined);
              }
            : null
        }
        onOpenChat={() => {
          closeHelper();
          navigate(helperPath(helper.id, leadId));
        }}
        answer={<HelperAnswer sessionId={helper.id} chat={chat} />}
        trimmedAt={trimmedAt}
      />
    </aside>
  );
}

/**
 * A helper as a chat of its own, full width, under a banner that names its lead. It has no composer:
 * the lead talks to it. A helper that asks can still be answered here. A trimmed helper shows its
 * receipt in place of the steps it no longer has.
 */
export function HelperChat({ id, lead }: { id: string; lead: string }) {
  const chat = useSession(id, (view) => view.chat);
  const leadTitle = useLeadTitle(lead);
  const trimmedAt = useTrimmedAt(id);
  const listedAgent = useSessionList().find((item) => item.session_id === id)?.agent;
  const ref = useBatch(lead, undefined, id).helpers.find((item) => item.id === id);
  const { stopHelper } = usePageActions();
  const navigate = useNavigate();
  const summary = helperSummary(chat);
  const banner = helperBanner({ lead: leadTitle, ref, chat, agent: listedAgent });
  const back = () => {
    navigate(sessionPath(lead));
  };
  return (
    <div data-helper-chat className="flex min-h-0 flex-1 flex-col">
      <HelperBannerBar
        banner={banner}
        leadId={lead}
        onBack={back}
        onStop={
          banner.running
            ? () => {
                stopHelper(id).catch(() => undefined);
              }
            : null
        }
      />
      {trimmedAt !== null ? (
        <div className="mx-auto w-full max-w-column px-5 pt-4">
          <HelperReceiptCard receipt={helperReceipt({ ref, chat, trimmedAt })} lead={{ id: lead, onOpen: back }} />
        </div>
      ) : null}
      {summary.question === null || trimmedAt !== null ? null : (
        <div className="mx-auto flex w-full max-w-column flex-col gap-2 px-5 pt-4">
          <p className="text-sm text-pretty">{summary.question}</p>
          <HelperAnswer sessionId={id} chat={chat} />
        </div>
      )}
      {trimmedAt === null ? <TranscriptColumn chat={chat} detail="verbose" thinkingShown /> : null}
    </div>
  );
}
