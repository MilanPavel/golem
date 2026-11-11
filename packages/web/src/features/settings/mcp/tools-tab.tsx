import { firstLine, formatTokens, ownToolName } from "@golem/view";
import { useId, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpServer, McpToolsResult } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { fieldClass, Input } from "../../../ui/input.tsx";
import { TryTool } from "./try-tool.tsx";

type Tool = McpToolsResult["tools"][number];
type ToolsQuery = { data: McpToolsResult | undefined; isError: boolean; error: unknown; refetch: () => unknown };

/** What the tools tab and the try tab show when the server is not running: there is nothing to list. */
export function NotRunning({ server, sessionId, onStart }: { server: McpServer; sessionId: string | null; onStart: () => void }) {
  const here = sessionId !== null && server.on_demand && server.state !== "disabled";
  const disabled = server.state === "disabled";
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-bg px-4 py-4">
      <p className="text-sm font-medium">{server.name} is not running.</p>
      <p className="text-sm text-muted">
        {disabled ? "Enable it to see its tools." : "Start it to see its tools."}
        {here ? " It only runs in the chats that turn it on." : ""}
      </p>
      {disabled ? null : (
        <Button size="sm" onClick={onStart}>
          Start
        </Button>
      )}
    </div>
  );
}

function QueryError({ tools }: { tools: ToolsQuery }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-sm text-deny">
        {actionErrorText(tools.error, "Could not read the tools.")}
      </p>
      <Button size="sm" onClick={() => void tools.refetch()}>
        Retry
      </Button>
    </div>
  );
}

/** The tools of a running server: one switch each for whether the model sees it, and a way into trying it. */
export function ToolsTab({ server, sessionId, tools, onTry }: { server: McpServer; sessionId: string | null; tools: ToolsQuery; onTry: (tool: string) => void }) {
  const actions = usePageActions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const list = tools.data?.tools ?? [];
  const on = list.filter((tool) => tool.hidden !== true);
  const tokens = on.reduce((sum, tool) => sum + (tool.schema_tokens ?? 0), 0);
  const needle = query.trim().toLowerCase();
  const found = needle === "" ? list : list.filter((tool) => `${ownToolName(server.name, tool.name)} ${tool.description}`.toLowerCase().includes(needle));

  async function toggle(tool: Tool): Promise<void> {
    const own = ownToolName(server.name, tool.name);
    const hide = tool.hidden !== true;
    setBusy(tool.name);
    try {
      await actions.setMcpToolHidden(server.name, own, hide, sessionId);
      setError(null);
      setNotice(`${own} is ${hide ? "hidden from" : "shown to"} the model`);
    } catch (failure) {
      setNotice(null);
      setError(actionErrorText(failure, `Could not change ${own}.`));
    } finally {
      setBusy(null);
    }
  }

  if (tools.isError) return <QueryError tools={tools} />;
  if (tools.data === undefined) return <p className="font-mono text-sm text-muted">loading…</p>;
  if (list.length === 0) return <p className="text-sm text-muted">This server has no tools.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h4 className="text-sm">
          <span className="font-semibold">Tools</span>{" "}
          <span className="font-mono text-xs text-muted">
            {on.length} of {list.length} on · about {formatTokens(tokens)} tokens a turn
          </span>
        </h4>
        <Input type="search" aria-label="Search tools" placeholder="Search tools" className="w-56" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <p role="status" aria-live="polite" className="font-mono text-xs text-muted empty:hidden">
        {notice}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {found.length === 0 ? (
        <p className="text-sm text-muted">No tool matches "{query.trim()}".</p>
      ) : (
        <ul aria-label={`${server.name} tools`} className="divide-y divide-line rounded-lg border border-line">
          {found.map((tool) => {
            const own = ownToolName(server.name, tool.name);
            const shown = tool.hidden !== true;
            return (
              <li key={tool.name} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={shown}
                  aria-label={`Show ${own} to the model`}
                  disabled={busy !== null}
                  onClick={() => void toggle(tool)}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full outline-offset-2 outline-clay focus-visible:outline-2 disabled:opacity-50",
                    shown ? "bg-clay" : "bg-line-strong",
                  )}
                >
                  <span aria-hidden="true" className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform motion-reduce:transition-none", shown && "translate-x-4")} />
                </button>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("font-mono text-sm wrap-anywhere", !shown && "text-faint line-through")}>
                    {own}
                    {tool.read_only === true ? (
                      <span
                        title={server.approval === "ask" ? "The server says this tool only reads. It still asks, as every tool of this server does." : "The server says this tool only reads."}
                        className="ml-2 rounded-sm border border-line px-1 font-sans text-xs text-muted no-underline"
                      >
                        read-only
                      </span>
                    ) : null}
                  </span>
                  <span title={tool.description} className={cn("truncate text-sm", shown ? "text-muted" : "text-faint line-through")}>
                    {firstLine(tool.description)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">{shown ? formatTokens(tool.schema_tokens ?? 0) : "hidden"}</span>
                <button
                  type="button"
                  aria-label={`Try ${own}`}
                  onClick={() => onTry(tool.name)}
                  className="rounded-sm px-1.5 py-0.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2"
                >
                  <span aria-hidden="true">▸</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A picker for one tool, and the form to run it below. */
export function TryTab({ server, sessionId, tools, chosen, onChoose }: { server: McpServer; sessionId: string | null; tools: ToolsQuery; chosen: string | null; onChoose: (tool: string) => void }) {
  const id = useId();
  if (tools.isError) return <QueryError tools={tools} />;
  if (tools.data === undefined) return <p className="font-mono text-sm text-muted">loading…</p>;
  const list = tools.data.tools;
  if (list.length === 0) return <p className="text-sm text-muted">This server has no tools.</p>;
  const tool = list.find((item) => item.name === chosen) ?? list[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={id}>Tool</label>
        <select id={id} className={cn(fieldClass, "font-mono sm:max-w-sm")} value={tool?.name} onChange={(event) => onChoose(event.target.value)}>
          {list.map((item) => (
            <option key={item.name} value={item.name}>
              {ownToolName(server.name, item.name)}
            </option>
          ))}
        </select>
      </div>
      {tool === undefined ? null : <TryTool key={tool.name} server={server} tool={tool} sessionId={sessionId} />}
    </div>
  );
}
