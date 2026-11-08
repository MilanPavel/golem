import { formatLogLine } from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpServer } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";

const KEPT = 500;

/** The server's log, which keeps coming in while it is open. It scrolls to the newest line while Follow is on. */
export function LogsView({ server, sessionId, onBack }: { server: McpServer; sessionId: string | null; onBack: () => void }) {
  const actions = usePageActions();
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const name = server.name;

  useEffect(() => {
    let live = true;
    const off = actions.watchMcpLog((log) => {
      if (live && log.name === name) setLines((now) => [...(now ?? []), ...log.lines.map(formatLogLine)].slice(-KEPT));
    });
    actions.mcpLogs(name, sessionId).then(
      (logs) => {
        if (live) setLines(logs.lines.map(formatLogLine));
      },
      (failure: unknown) => {
        if (live) setError(actionErrorText(failure, "Could not read the log."));
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [actions, name, sessionId]);

  useEffect(() => {
    const element = box.current;
    if (follow && element !== null) element.scrollTop = element.scrollHeight;
  }, [lines, follow]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onBack}>
          Back
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          Follow
        </label>
      </div>
      <h3 className="font-mono text-base font-semibold wrap-anywhere">{name} log</h3>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {lines === null && error === null ? <p className="font-mono text-sm text-muted">loading…</p> : null}
      {lines !== null && lines.length === 0 ? <p className="text-sm text-muted">Nothing logged yet.</p> : null}
      {lines !== null && lines.length > 0 ? (
        <div
          ref={box}
          role="log"
          aria-label={`${name} log`}
          aria-live="off"
          tabIndex={0}
          className="max-h-96 overflow-y-auto rounded-lg border border-line bg-sunken p-3 font-mono text-xs outline-offset-2 outline-clay focus-visible:outline-2"
        >
          {lines.map((line, index) => (
            <p key={index} className="wrap-anywhere whitespace-pre-wrap">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
