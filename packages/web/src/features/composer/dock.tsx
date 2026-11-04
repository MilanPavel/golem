import type { ReactNode } from "react";
import { NoticeLine, type CommandNotice } from "./notice-line.tsx";

/** The meter, the composer, a line for an error or a notice, and the key hints, in a column. */
export function DockView({
  meter,
  composer,
  error,
  notice = null,
  busy,
}: {
  meter: ReactNode;
  composer: ReactNode;
  error?: string | null;
  /** What the last command did, in a muted status line. */
  notice?: CommandNotice | null;
  /** Shows the Esc hint, which only works while a run is in progress. */
  busy: boolean;
}) {
  return (
    <div data-dock="" className="flex flex-col gap-2">
      {meter}
      {composer}
      {error ? (
        <p role="alert" className="px-1 text-xs text-deny">
          {error}
        </p>
      ) : null}
      {notice === null ? null : <NoticeLine notice={notice} />}
      <p className="px-1 font-mono text-xs text-faint max-sm:hidden">
        {busy ? "↵ send · ⇧↵ new line · esc stop" : "↵ send · ⇧↵ new line"}
      </p>
    </div>
  );
}
