import type { ChatMessage, ChatState, ToolBlock } from "@golem/view";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import type { GolemState } from "../../ui/golem-state.ts";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { formatClock, formatDuration, shouldStick, squeezeArgs } from "./format.ts";
import { Markdown } from "./markdown-view.tsx";

function ToolResult({ tool }: { tool: ToolBlock }) {
  switch (tool.status) {
    case "done":
      return <span className="whitespace-nowrap text-faint"><span aria-hidden="true" className="text-allow">✓ </span>{tool.summary ?? "done"}</span>;
    case "failed":
      return <span className="max-w-1/2 truncate whitespace-nowrap text-deny" title={tool.error}><span aria-hidden="true">✗ </span>{tool.error ?? "failed"}</span>;
    case "waiting":
      return <span className="whitespace-nowrap text-wait">waiting for you</span>;
    default:
      return <span className="whitespace-nowrap text-muted">running…</span>;
  }
}

/** One tool call as a line. Its tablet and its approval come in step 10.9. */
export function ToolLine({ tool }: { tool: ToolBlock }) {
  const args = squeezeArgs(tool.args);
  return (
    <li data-tool-status={tool.status} className="tool-line">
      <span aria-hidden="true" className="text-faint">›</span>
      <span className="font-medium text-ink">{tool.name}</span>
      <span className="truncate" title={args}>{args}</span>
      <ToolResult tool={tool} />
    </li>
  );
}

function golemState(message: ChatMessage): GolemState {
  if (message.tools?.some((tool) => tool.status === "waiting")) return "waiting";
  return message.streaming ? "thinking" : "idle";
}

export const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  const time = formatClock(message.at);
  return (
    <article aria-label="You" className="flex max-w-xl flex-col items-end self-end">
      <div className="min-w-0 rounded-lg rounded-br-xs bg-slip px-3.5 py-2.5 text-sm leading-normal wrap-anywhere whitespace-pre-wrap">
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

export const GolemMessage = memo(function GolemMessage({ message }: { message: ChatMessage }) {
  const tools = message.tools ?? [];
  const duration = message.durationMs === undefined ? "" : formatDuration(message.durationMs);
  const foot = [duration, tools.length > 0 ? `${tools.length} ${tools.length === 1 ? "tool" : "tools"}` : ""].filter(Boolean);
  return (
    <article aria-label="golem" className="flex min-w-0 flex-col gap-2.5">
      <PixelGolem state={golemState(message)} size="sm" />
      {tools.length > 0 ? (
        <ul aria-label="Tool calls" className="flex list-none flex-col gap-0.5 p-0 font-mono text-xs leading-snug">
          {tools.map((tool) => (
            <ToolLine key={tool.callId} tool={tool} />
          ))}
        </ul>
      ) : null}
      {message.text ? (
        <div className="prose">
          <Markdown text={message.text} streaming={message.streaming} />
        </div>
      ) : null}
      {message.streaming ? <span aria-hidden="true" data-cursor className="transcript-cursor" /> : null}
      {message.interrupted ? <p className="font-mono text-xs text-muted">stopped</p> : null}
      {!message.streaming && foot.length > 0 ? (
        <p className="font-mono text-xs text-faint">{foot.join(" · ")}</p>
      ) : null}
    </article>
  );
});

/** The messages and the closing error or notice. Pure: the page's stores are not read here. */
export function TranscriptMessages({ chat }: { chat: Pick<ChatState, "messages" | "error" | "notice"> }) {
  if (chat.messages.length === 0 && !chat.error && !chat.notice) {
    return <p className="text-sm text-faint">No messages yet.</p>;
  }
  return (
    <>
      {chat.messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <GolemMessage key={message.id} message={message} />
        ),
      )}
      {chat.error ? <p role="alert" className="text-sm text-deny">{chat.error}</p> : null}
      {chat.notice ? <p role="status" className="text-sm text-muted">{chat.notice}</p> : null}
    </>
  );
}

/**
 * The scrolling column. While you are at the bottom it follows the text; once you scroll up it
 * stays where you are and offers a way back down.
 */
export function TranscriptColumn({ chat, className }: { chat: Pick<ChatState, "messages" | "error" | "notice">; className?: string }) {
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
        <div ref={content} className="mx-auto flex max-w-column flex-col gap-6 px-5 py-7">
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

/** A session's transcript, read from the page's session store. */
export function Transcript({ id }: { id: string }) {
  const chat = useSession(id, (view) => view.chat);
  return <TranscriptColumn chat={chat} />;
}
