import type { ReactNode } from "react";
import { useSendKey } from "../chat/chat-choices.ts";
import { sendHint } from "./send-hint.ts";
import { NoticeLine, type CommandNotice } from "./notice-line.tsx";

/** The meter, the composer, a line for an error or a notice, and the key hints, in a column. */
export function DockView({
  meter,
  approval = null,
  question = null,
  hint = null,
  composer,
  error,
  notice = null,
  busy,
}: {
  meter: ReactNode;
  /** The approval that waits, directly above the composer. */
  approval?: ReactNode;
  /** The question about running checks, above the composer. */
  question?: ReactNode;
  /** A line above the composer, such as how long a local model will take. */
  hint?: ReactNode;
  composer: ReactNode;
  error?: string | null;
  /** What the last command did, in a muted status line. */
  notice?: CommandNotice | null;
  /** Shows the Esc hint, which only works while a run is in progress. */
  busy: boolean;
}) {
  const sendKey = useSendKey();
  return (
    <div data-dock="" className="flex flex-col gap-2">
      {meter}
      {approval}
      {question}
      {hint}
      {composer}
      {error ? (
        <p role="alert" className="px-1 text-xs text-deny">
          {error}
        </p>
      ) : null}
      {notice === null ? null : <NoticeLine notice={notice} />}
      <p className="px-1 text-meta text-faint max-sm:hidden">
        {sendHint(sendKey, busy)}
      </p>
    </div>
  );
}
