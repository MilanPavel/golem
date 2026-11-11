import { displayToolName, formatTurnTime, groupTurns, stepCount, stepMark, summarizeSteps, turnFooter, LIVE_OUTPUT_CHARS, thinkingLine, unreadCallNotice, type ChatMessage, type ChatState, type Detail, type StepMark, type ToolBlock } from "@golem/view";
import { memo, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "../../store/page-context.tsx";
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
import { Markdown } from "./markdown-view.tsx";

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

/** One tool call as a line that opens into its tablet: the arguments and the output. The answered approval is a chip after the row. */
export function ToolLine({ tool, defaultOpen = false, pending = false }: { tool: ToolBlock; defaultOpen?: boolean; pending?: boolean }) {
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
 * The tools of a whole turn as one line under the answer: a dot each and a summary. It opens into
 * the steps. A tool that waits for you keeps it open, and Verbose opens it with every row expanded. A tool
 * that had an approval shows how it ended as a chip; the one still waiting is asked in the dock instead.
 */
export function ActivityLine({ tools, detail, streaming = false, pendingId = null }: { tools: readonly ToolBlock[]; detail: Detail; streaming?: boolean; pendingId?: string | null }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const listId = useId();
  if (tools.length === 0) return null;
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
      {open ? (
        <ul id={listId} aria-label="Tool calls" className="flex list-none flex-col gap-0.5 border-l border-line py-0.5 pl-3 font-mono text-xs leading-snug">
          {tools.map((tool) => (
            <ToolLine key={`${tool.callId}:${verbose}`} tool={tool} defaultOpen={verbose} pending={tool.callId === pendingId} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One run: one golem, each model step in order, one activity line for all their tools, and one footer once the run is done. */
export function GolemTurn({
  steps,
  pendingId = null,
  thinkingShown,
  detail: detailOverride,
}: { steps: readonly ChatMessage[]; pendingId?: string | null; thinkingShown?: boolean; detail?: Detail }) {
  const chosenDetail = useDetail();
  const detail = detailOverride ?? chosenDetail;
  const footer = turnFooter(steps);
  const tools = steps.flatMap((step) => step.tools ?? []);
  const foot = footer
    ? [footer.durationMs === undefined ? "" : formatTurnTime(footer.durationMs), footer.tools > 0 ? stepCount(footer.tools) : ""].filter(Boolean)
    : [];
  return (
    <article aria-label="golem" className="flex min-w-0 flex-col gap-2.5">
      <PixelGolem state={golemState(steps)} size="sm" />
      {steps.map((message) => (
        <GolemStep key={message.id} message={message} thinkingShown={thinkingShown} />
      ))}
      <ActivityLine tools={tools} detail={detail} streaming={steps.some((step) => step.streaming)} pendingId={pendingId} />
      {foot.length > 0 ? <p className="font-mono text-xs text-faint">{foot.join(" · ")}</p> : null}
    </article>
  );
}

/** What the transcript draws of the chat. `approval` names the call whose approval waits in the dock. */
export type TranscriptChat = Pick<ChatState, "messages" | "error" | "notice"> & Partial<Pick<ChatState, "approval" | "unreadCall">>;

/** The messages and the closing error or notice. Pure: the page's stores are not read here. */
export function TranscriptMessages({ chat, thinkingShown, detail }: { chat: TranscriptChat; thinkingShown?: boolean; detail?: Detail }) {
  const pendingId = chat.approval?.callId ?? null;
  const notice = chat.notice ?? (chat.unreadCall === true ? unreadCallNotice("web") : null);
  if (chat.messages.length === 0 && !chat.error && !notice) {
    return <p className="text-sm text-faint">No messages yet.</p>;
  }
  return (
    <>
      {groupTurns(chat.messages).map((turn) =>
        turn.kind === "user" ? (
          <UserMessage key={turn.id} message={turn.message} />
        ) : (
          <GolemTurn
            key={turn.id}
            steps={turn.steps}
            pendingId={pendingId}
            thinkingShown={thinkingShown}
            detail={detail}
          />
        ),
      )}
      {chat.error ? <p role="alert" className="text-sm text-deny">{chat.error}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted">{notice}</p> : null}
    </>
  );
}

/**
 * The scrolling column. While you are at the bottom it follows the text; once you scroll up it
 * stays where you are and offers a way back down.
 */
export function TranscriptColumn({ chat, className }: { chat: TranscriptChat; className?: string }) {
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
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" data-transcript-scroller>
        <div ref={content} className="mx-auto flex max-w-column flex-col gap-8 px-5 py-7">
          <TranscriptMessages chat={chat} />
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

/** A session's transcript, read from the page's session store. The approval that waits is in the dock. */
export function Transcript({ id }: { id: string }) {
  const chat = useSession(id, (view) => view.chat);
  return <TranscriptColumn chat={chat} />;
}
