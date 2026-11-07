import {
  detailChoices,
  firstLine,
  formatSeconds,
  formatTokens,
  mcpStatusMark,
  mcpStatusWord,
  mcpSummary,
  MCP_HINT,
  orderedServers,
  ownToolName,
  shortPath,
  type DetailChoice,
  type McpDetailAction,
} from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { McpServer } from "../../store/mcp.ts";
import { useMcpList, useMcpTools, usePageActions } from "../../store/page-context.tsx";
import { AddDialog } from "./mcp/add-dialog.tsx";
import { EditServer } from "./mcp/edit-form.tsx";
import { LogsView } from "./mcp/logs-view.tsx";
import { TestView } from "./mcp/test-view.tsx";
import { TryTool } from "./mcp/try-tool.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { useSettingsContext, useSettingsFolder } from "./context.ts";
import { mcpAddRequestStore, useMcpAddRequest } from "./mcp-add-request.ts";

type Selected = { name: string; project: string | null };
type View = { kind: "list" } | { kind: "detail" | "tools" | "test" | "logs" | "edit"; at: Selected };

const TONE = { ok: "text-allow", bad: "text-deny", wait: "text-wait", off: "text-faint" } as const;
const DEFAULT_FILE = "~/.golem/config.toml";

function same(server: McpServer, at: Selected): boolean {
  return server.name === at.name && (server.project ?? null) === at.project;
}

function keyOf(server: McpServer): string {
  return `${server.project ?? ""}\u0000${server.name}`;
}

/** The MCP servers, as `/mcp` lists them: by the file that names each, then one server's details and its tools. */
export function McpSection() {
  const context = useSettingsContext();
  const sessionId = context?.sessionId ?? null;
  const list = useMcpList(sessionId);
  const folder = useSettingsFolder();
  const [view, setView] = useState<View>({ kind: "list" });
  const [adding, setAdding] = useState<{ id: string | null } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const request = useMcpAddRequest();
  const rows = useRef(new Map<string, HTMLButtonElement>());
  /** The row to give focus back to when the list shows again. */
  const back = useRef<string | null>(null);
  const register = useCallback((key: string, node: HTMLButtonElement | null) => {
    if (node === null) rows.current.delete(key);
    else rows.current.set(key, node);
  }, []);

  useEffect(() => {
    if (view.kind !== "list" || back.current === null) return;
    rows.current.get(back.current)?.focus();
    back.current = null;
  }, [view]);

  // `/mcp add` in a chat asks for the dialog through the request store; closing it takes the request.
  const wanted = adding ?? request;
  const closeAdd = (): void => {
    setAdding(null);
    mcpAddRequestStore.set(null);
  };
  const dialog = (
    <AddDialog
      open={wanted !== null}
      onOpenChange={(open) => (open ? undefined : closeAdd())}
      sessionId={sessionId}
      folder={folder}
      initial={wanted?.id ?? null}
      onAdded={(name) => {
        closeAdd();
        setAdded(name);
      }}
    />
  );
  if (list.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(list.error, "Could not read the servers.")}
        </p>
        <Button size="sm" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (list.data === undefined) {
    return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  }
  const servers = orderedServers(list.data.servers);
  const at = view.kind === "list" ? null : view.at;
  const server = at === null ? undefined : servers.find((item) => same(item, at));
  if (view.kind === "list" || server === undefined) {
    return (
      <>
        <ServerList
          servers={servers}
          register={register}
          added={added}
          onAdd={() => setAdding({ id: null })}
          onOpen={(item) => setView({ kind: "detail", at: { name: item.name, project: item.project ?? null } })}
        />
        {dialog}
      </>
    );
  }
  const leave = (): void => {
    back.current = keyOf(server);
    setView({ kind: "list" });
  };
  const toDetail = (): void => setView({ kind: "detail", at: view.at });
  if (view.kind === "edit") {
    return <EditServer server={server} sessionId={sessionId} onBack={toDetail} onSaved={toDetail} />;
  }
  if (view.kind === "tools") {
    return <ToolsView server={server} sessionId={sessionId} onBack={toDetail} />;
  }
  if (view.kind === "test") {
    return <TestView server={server} sessionId={sessionId} onBack={toDetail} />;
  }
  if (view.kind === "logs") {
    return <LogsView server={server} sessionId={sessionId} onBack={toDetail} />;
  }
  return (
    <Detail
      server={server}
      sessionId={sessionId}
      onBack={leave}
      onOpen={(next) => setView({ kind: next, at: view.at })}
    />
  );
}

function ServerList({
  servers,
  register,
  added,
  onAdd,
  onOpen,
}: {
  servers: readonly McpServer[];
  register: (key: string, node: HTMLButtonElement | null) => void;
  added: string | null;
  onAdd: () => void;
  onOpen: (server: McpServer) => void;
}) {
  const addButton = (
    <div className="flex flex-wrap items-center gap-3">
      <Button kind="primary" onClick={onAdd}>
        Add a server
      </Button>
      <p role="status" aria-live="polite" className="font-mono text-xs text-muted">
        {added === null ? null : `added ${added}`}
      </p>
    </div>
  );
  if (servers.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">0 servers</p>
        <p className="text-sm text-muted">{MCP_HINT}</p>
        {addButton}
      </div>
    );
  }
  const groups: { project: string | null; servers: McpServer[] }[] = [];
  for (const server of servers) {
    const project = server.project ?? null;
    const last = groups.at(-1);
    if (last !== undefined && last.project === project) last.servers.push(server);
    else groups.push({ project, servers: [server] });
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {servers.length} {servers.length === 1 ? "server" : "servers"}
      </p>
      {addButton}
      {groups.map((group) => (
        <section key={group.project ?? ""} aria-label={group.project === null ? "Yours" : "This project"} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {group.project === null ? "Yours" : "This project"}{" "}
            <span className="font-mono text-xs font-normal text-muted wrap-anywhere">
              ({shortPath(group.servers[0]?.config ?? (group.project === null ? DEFAULT_FILE : group.project), "")})
            </span>
          </h3>
          <ul className="flex flex-col gap-2">
            {group.servers.map((server) => {
              const mark = mcpStatusMark(server);
              return (
                <li key={keyOf(server)}>
                  <button
                    type="button"
                    ref={(node) => register(keyOf(server), node)}
                    onClick={() => onOpen(server)}
                    className={cn(
                      "flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-left outline-offset-2 outline-clay hover:border-line-strong focus-visible:outline-2",
                      server.state === "disabled" && "opacity-70",
                    )}
                  >
                    <span aria-hidden="true" className={cn("font-mono text-sm", TONE[mark.tone])}>
                      {mark.text}
                    </span>
                    <span className="sr-only">{mcpStatusWord(server)}, </span>
                    <span className="font-mono text-sm">{server.name}</span>
                    <span className="min-w-0 flex-1 font-mono text-xs text-muted wrap-anywhere">{mcpSummary(server)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 wrap-anywhere">{children}</dd>
    </div>
  );
}

function Detail({ server, sessionId, onBack, onOpen }: { server: McpServer; sessionId: string | null; onBack: () => void; onOpen: (screen: "tools" | "test" | "logs" | "edit") => void }) {
  const actions = usePageActions();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<(DetailChoice & { action: McpDetailAction }) | null>(null);
  const [removing, setRemoving] = useState(false);
  const mark = mcpStatusMark(server);
  const isUrl = /^https?:\/\//.test(server.command);
  const count = server.tools?.length ?? 0;
  // Without a session there is no chat to turn a server on for, so those choices are not offered.
  const shown = sessionId === null ? { ...server, on_demand: false } : server;
  const choices = detailChoices(shown);

  async function run(action: McpDetailAction): Promise<void> {
    try {
      switch (action.kind) {
        case "restart":
          await actions.restartMcp(action.name, sessionId);
          setNotice(`reconnecting ${action.name}…`);
          break;
        case "set-enabled":
          await actions.setMcpEnabled(action.name, action.enabled, sessionId);
          setNotice(
            `${action.name} is ${action.enabled === false ? "disabled everywhere" : action.enabled === true ? "on for every chat" : "on demand"}`,
          );
          break;
        case "session":
          if (sessionId === null) return;
          await actions.toggleMcp(sessionId, action.name, action.on);
          setNotice(`${action.name} is ${action.on ? "on" : "off"} for this chat`);
          break;
      }
      setError(null);
    } catch (failure) {
      setNotice(null);
      setError(actionErrorText(failure, `Could not change ${action.name}.`));
    }
  }

  async function remove(): Promise<void> {
    try {
      await actions.removeMcp(server.name);
    } catch (failure) {
      setNotice(null);
      setError(actionErrorText(failure, `Could not remove ${server.name}.`));
    }
  }

  function press(choice: DetailChoice): void {
    if (choice.action === "view-tools") return onOpen("tools");
    if (choice.action === "run-test") return onOpen("test");
    if (choice.action === "view-logs") return onOpen("logs");
    if (choice.action === "ask-remove") return setRemoving(true);
    // Enabling starts a process the file named earlier, from a click in a browser, so it asks first.
    if (choice.action.kind === "set-enabled" && choice.action.enabled !== false) {
      setAsking({ ...choice, action: choice.action });
      return;
    }
    void run(choice.action);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
      <h3 className="font-mono text-base font-semibold wrap-anywhere">{server.name}</h3>
      <dl className="flex flex-col gap-1 text-sm">
        <Fact label="Status">
          <span aria-hidden="true" className={cn("font-mono", TONE[mark.tone])}>
            {mark.text}
          </span>{" "}
          {mcpStatusWord(server)}
        </Fact>
        <Fact label={isUrl ? "URL" : "Command"}>
          <span className="font-mono text-xs">{server.command}</span>
        </Fact>
        {server.config ? (
          <Fact label="Config">
            <span className="font-mono text-xs">{shortPath(server.config, "")}</span>
          </Fact>
        ) : null}
        {server.state === "running" ? (
          <Fact label="Tools">
            {count} {count === 1 ? "tool" : "tools"}
            {server.schema_tokens == null ? "" : ` · ≈${formatTokens(server.schema_tokens)} tokens per prompt`}
          </Fact>
        ) : null}
        {server.state === "failed" ? <Fact label="Error">{server.error ?? "failed"}</Fact> : null}
        {server.state === "failed" && server.retry_seconds != null ? (
          <Fact label="Next try">in {formatSeconds(server.retry_seconds)}</Fact>
        ) : null}
        {sessionId !== null && server.state !== "disabled" ? (
          <Fact label="In this chat">
            {server.enabled === true ? "on" : "off"} · {server.on_demand ? "on demand" : "every chat"}
          </Fact>
        ) : null}
      </dl>
      <p role="status" aria-live="polite" className="min-h-5 font-mono text-xs text-muted">
        {notice}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {server.project != null && sessionId === null ? null : (
          <Button kind="secondary" onClick={() => onOpen("edit")}>
            Edit
          </Button>
        )}
        {choices.map((choice) => (
          <Button key={choice.label} kind={choice.action === "ask-remove" ? "danger" : "secondary"} onClick={() => press(choice)}>
            {choice.label}
          </Button>
        ))}
      </div>
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogTitle>Remove {server.name}?</DialogTitle>
          <DialogDescription>
            Its entry leaves <span className="font-mono wrap-anywhere">{shortPath(server.config ?? "~/.golem/config.toml", "")}</span>, and the token it stored leaves the Keychain.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button autoFocus onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                setRemoving(false);
                void remove();
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={asking !== null} onOpenChange={(open) => (open ? undefined : setAsking(null))}>
        <DialogContent>
          {asking === null ? null : (
            <>
              <DialogTitle>Enable {server.name}?</DialogTitle>
              <DialogDescription>
                <span className="font-mono wrap-anywhere">{server.command}</span>
                <br />
                golem will run this on your Mac.
              </DialogDescription>
              <div className="mt-4 flex justify-end gap-2">
                <Button autoFocus onClick={() => setAsking(null)}>
                  Cancel
                </Button>
                <Button
                  kind="primary"
                  onClick={() => {
                    const action = asking.action;
                    setAsking(null);
                    void run(action);
                  }}
                >
                  Enable
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToolsView({ server, sessionId, onBack }: { server: McpServer; sessionId: string | null; onBack: () => void }) {
  const tools = useMcpTools(server.name, sessionId);
  const actions = usePageActions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [trying, setTrying] = useState<string | null>(null);
  const list = tools.data?.tools ?? [];
  const hidden = list.filter((tool) => tool.hidden === true).length;
  const tried = list.find((tool) => tool.name === trying);

  async function toggle(tool: (typeof list)[number]): Promise<void> {
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

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
      <h3 className="font-mono text-base font-semibold wrap-anywhere">{server.name} tools</h3>
      <p role="status" aria-live="polite" className="min-h-5 font-mono text-xs text-muted">
        {notice}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {tools.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {actionErrorText(tools.error, "Could not read the tools.")}
          </p>
          <Button size="sm" onClick={() => void tools.refetch()}>
            Retry
          </Button>
        </div>
      ) : tools.data === undefined ? (
        <p className="font-mono text-sm text-muted">loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">No tools while the server is not running.</p>
      ) : (
        <>
          <ul aria-label={`${server.name} tools`} className="flex flex-col gap-2">
            {list.map((tool) => {
              const own = ownToolName(server.name, tool.name);
              const shown = tool.hidden !== true;
              return (
                <li key={tool.name} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2", !shown && "opacity-70")}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    aria-label={`Show ${own} to the model`}
                    disabled={busy !== null}
                    onClick={() => void toggle(tool)}
                    className="rounded-md border border-line-strong px-2 py-0.5 font-mono text-xs outline-offset-2 outline-clay focus-visible:outline-2 disabled:opacity-50"
                  >
                    {shown ? "shown" : "hidden"}
                  </button>
                  <span className="font-mono text-sm">{own}</span>
                  <span className="font-mono text-xs text-muted">≈{formatTokens(tool.schema_tokens ?? 0)} tokens</span>
                  <span className="min-w-0 flex-1 text-xs text-muted wrap-anywhere">{firstLine(tool.description)}</span>
                  <Button size="sm" aria-label={`Try ${own}`} onClick={() => setTrying(tool.name)}>
                    Try
                  </Button>
                </li>
              );
            })}
          </ul>
          {hidden === 0 ? null : <p className="text-xs text-muted">{hidden} hidden from the model (tools.exclude).</p>}
        </>
      )}
      <Dialog open={tried !== undefined} onOpenChange={(open) => (open ? undefined : setTrying(null))}>
        <DialogContent>
          {tried === undefined ? null : <TryTool key={tried.name} server={server} tool={tried} sessionId={sessionId} onClose={() => setTrying(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
