import {
  detailChoices,
  formatSeconds,
  mcpStatusWord,
  mcpSummary,
  ONLY_WHEN_ASKED,
  MCP_HINT,
  orderedServers,
  shortPath,
  type DetailChoice,
  type McpDetailAction,
} from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { McpServer } from "../../store/mcp.ts";
import { useMcpList, useMcpTools, usePageActions } from "../../store/page-context.tsx";
import { AddDialog } from "./mcp/add-dialog.tsx";
import { ImportDialog } from "./mcp/import-dialog.tsx";
import { EditServer } from "./mcp/edit-form.tsx";
import { LogsView } from "./mcp/logs-view.tsx";
import { TestView } from "./mcp/test-view.tsx";
import { NotRunning, ToolsTab, TryTab } from "./mcp/tools-tab.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { useNarrow } from "../trace/use-narrow.ts";
import { useSettingsContext, useSettingsFolder } from "./context.ts";
import { mcpAddRequestStore, useMcpAddRequest } from "./mcp-add-request.ts";

type Selected = { name: string; project: string | null };
type View = { kind: "list" } | { kind: "detail"; at: Selected };

/** The square mark of a server's state; its word is always written beside it. */
function dotLook(server: McpServer): string {
  switch (server.state) {
    case "running":
      return "bg-allow";
    case "failed":
      return "bg-deny";
    case "starting":
      return "bg-wait";
    case "disabled":
      return "bg-line-strong";
    default:
      return "border border-faint";
  }
}

function Dot({ server }: { server: McpServer }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-xs", dotLook(server))} />;
}

const DEFAULT_FILE = "~/.golem/config.toml";

function same(server: McpServer, at: Selected): boolean {
  return server.name === at.name && (server.project ?? null) === at.project;
}

function groupFile(group: { project: string | null; servers: McpServer[] }): string {
  return group.servers[0]?.config ?? (group.project === null ? DEFAULT_FILE : group.project);
}

/** The home directory as `~`; the web page does not know it, so it is read off the path. */
function tilde(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
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
  const narrow = useNarrow();
  const [view, setView] = useState<View>({ kind: "list" });
  const [adding, setAdding] = useState<{ id: string | null } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
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
  const importDialog = (
    <ImportDialog
      open={importing}
      onOpenChange={setImporting}
      sessionId={sessionId}
      onImported={(names) => setAdded(names.join(", "))}
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
  const wide = !narrow;
  // On a wide window the details sit beside the list, so a server is always shown: the first, until one is picked.
  const first = servers[0];
  const picked = view.kind === "list" ? null : view.at;
  const pickedServer = picked === null ? undefined : servers.find((item) => same(item, picked));
  const server = pickedServer ?? (wide ? first : undefined);
  const at: Selected | null = server === undefined ? null : { name: server.name, project: server.project ?? null };
  const open = (item: McpServer): void => setView({ kind: "detail", at: { name: item.name, project: item.project ?? null } });
  const listPane = (
    <ServerList
      servers={servers}
      register={register}
      added={added}
      wide={wide}
      selected={wide ? at : null}
      session={sessionId !== null}
      onAdd={() => setAdding({ id: null })}
      onImport={() => setImporting(true)}
      onOpen={open}
    />
  );
  const dialogs = (
    <>
      {dialog}
      {importDialog}
    </>
  );
  if (server === undefined || at === null) {
    return (
      <>
        {listPane}
        {dialogs}
      </>
    );
  }
  const leave = (): void => {
    back.current = keyOf(server);
    setView({ kind: "list" });
  };
  const content = <Detail key={keyOf(server)} server={server} sessionId={sessionId} onBack={wide ? null : leave} />;
  if (!wide) {
    // A narrow window shows the list, or the details in its place.
    return (
      <>
        {view.kind === "list" || pickedServer === undefined ? listPane : content}
        {dialogs}
      </>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="w-mcp-list shrink-0 overflow-y-auto border-r border-line bg-bg p-3">{listPane}</div>
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">{content}</div>
      {dialogs}
    </div>
  );
}

function ServerList({
  servers,
  register,
  added,
  wide,
  selected,
  session,
  onAdd,
  onImport,
  onOpen,
}: {
  servers: readonly McpServer[];
  register: (key: string, node: HTMLButtonElement | null) => void;
  added: string | null;
  wide: boolean;
  selected: Selected | null;
  session: boolean;
  onAdd: () => void;
  onImport: () => void;
  onOpen: (server: McpServer) => void;
}) {
  const addButton = (
    <div className="flex flex-wrap items-center gap-2">
      <Button kind="primary" size={wide ? "sm" : undefined} onClick={onAdd}>
        <span aria-hidden="true">+</span> Add a server
      </Button>
      <Button size={wide ? "sm" : undefined} onClick={onImport} title="Import from other apps">
        Import
      </Button>
      <p role="status" aria-live="polite" className="font-mono text-xs text-muted empty:hidden">
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
    <div className={cn("flex flex-col", wide ? "gap-3" : "gap-4")}>
      <p className="text-sm text-muted">
        {servers.length} {servers.length === 1 ? "server" : "servers"}
      </p>
      {addButton}
      {groups.map((group) => (
        <section key={group.project ?? ""} aria-label={group.project === null ? "Yours" : "This project"} className="flex flex-col gap-2">
          {wide ? (
            <h3 className="min-w-0 px-2 font-mono text-xs font-normal text-faint">
              {group.project === null ? "Yours" : "This project"}
              <span className="block truncate" title={groupFile(group)}>
                {tilde(groupFile(group))}
              </span>
            </h3>
          ) : (
            <h3 className="text-sm font-semibold">
              {group.project === null ? "Yours" : "This project"}{" "}
              <span className="font-mono text-xs font-normal text-muted wrap-anywhere">({shortPath(groupFile(group), "")})</span>
            </h3>
          )}
          <ul className={cn("flex flex-col", wide ? "gap-0.5" : "gap-2")}>
            {group.servers.map((server) => {
              const current = selected !== null && same(server, selected);
              const summary = mcpSummary(server, session);
              // "on demand" or "disabled" with nothing more to say is already the word beside the name.
              const second = summary === mcpStatusWord(server) ? null : summary;
              return (
                <li key={keyOf(server)}>
                  <button
                    type="button"
                    ref={(node) => register(keyOf(server), node)}
                    onClick={() => onOpen(server)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex w-full gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
                      wide ? "flex-col gap-y-0.5" : "flex-wrap items-baseline bg-surface",
                      current ? "border-line-strong bg-surface" : wide ? "border-transparent hover:border-line" : "border-line hover:border-line-strong",
                      server.state === "disabled" && "opacity-70",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-x-2">
                      <Dot server={server} />
                      <span className="sr-only">{mcpStatusWord(server)}, </span>
                      <span className={cn("min-w-0 font-sans text-sm font-medium", wide ? "truncate" : "wrap-anywhere")}>{server.name}</span>
                      <span aria-hidden="true" className="shrink-0 font-mono text-xs whitespace-nowrap text-faint">
                        {mcpStatusWord(server)}
                      </span>
                    </span>
                    {second === null ? null : (
                      <span className={cn("min-w-0 font-mono text-xs wrap-anywhere", server.state === "failed" ? "text-deny" : "text-muted", wide ? "pl-4" : "flex-1")}>
                        {second}
                      </span>
                    )}
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

type Tab = "tools" | "try" | "logs" | "edit" | "test";
type Choice = DetailChoice & { action: McpDetailAction };

function isAction(choice: DetailChoice): choice is Choice {
  return typeof choice.action === "object";
}

function Detail({ server, sessionId, onBack }: { server: McpServer; sessionId: string | null; onBack: (() => void) | null }) {
  const actions = usePageActions();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Choice | null>(null);
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState<Tab>("tools");
  const [trying, setTrying] = useState<string | null>(null);
  // "starting github…" is true only until the server is running or has failed.
  const settled = server.state === "running" || server.state === "failed";
  const shownNotice = settled && notice?.endsWith("…") === true ? null : notice;
  const tools = useMcpTools(server.name, sessionId, server.state === "running");
  const isUrl = /^https?:\/\//.test(server.command);
  const file = server.config ?? DEFAULT_FILE;
  // Without a session there is no chat to turn a server on for, so those choices are not offered.
  const shown = sessionId === null ? { ...server, on_demand: false } : server;
  const choices = detailChoices(shown).filter(isAction);
  const restart = choices.find((choice) => choice.action.kind === "restart");
  const session = choices.find((choice) => choice.action.kind === "session");
  // Where the server runs: only the other places are offered.
  const mode: "off" | "on_demand" | "every" = server.state === "disabled" ? "off" : server.on_demand ? "on_demand" : "every";
  const place = (label: string, enabled: boolean | "on_demand"): Choice => ({ label, action: { kind: "set-enabled", name: server.name, enabled } });
  const more: Choice[] = [
    ...(mode === "every" ? [] : [place("Enable for every chat", true)]),
    ...(mode === "on_demand" ? [] : [place(ONLY_WHEN_ASKED, "on_demand")]),
    ...(mode === "off" ? [] : [place("Disable everywhere", false)]),
  ];
  const removable = detailChoices(shown).some((choice) => choice.action === "ask-remove");
  const editable = !(server.project != null && sessionId === null);

  async function run(action: McpDetailAction): Promise<void> {
    try {
      switch (action.kind) {
        case "restart":
          await actions.restartMcp(action.name, sessionId);
          setNotice(server.state === "idle" ? `starting ${action.name}…` : `reconnecting ${action.name}…`);
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

  function press(choice: Choice): void {
    // Enabling starts a process the file named earlier, from a click in a browser, so it asks first.
    if (choice.action.kind === "set-enabled" && choice.action.enabled !== false) {
      setAsking(choice);
      return;
    }
    void run(choice.action);
  }

  const start = (): void => {
    if (restart !== undefined) void run(restart.action);
  };
  const running = server.state === "running";
  const toTools = (): void => setTab("tools");

  return (
    <div className="flex flex-col gap-3">
      {onBack === null ? null : (
        <div>
          <Button size="sm" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <h3 className="font-sans text-lg font-semibold wrap-anywhere">{server.name}</h3>
          <p className="font-mono text-xs text-muted wrap-anywhere">
            <span className="sr-only">{isUrl ? "URL: " : "Command: "}</span>
            {server.command}
          </p>
          <p className="font-mono text-xs text-muted wrap-anywhere">
            {server.project == null ? "Yours" : "This project"} · {tilde(file)}
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-2 pt-1.5 font-mono text-xs text-muted">
          <Dot server={server} />
          {mcpStatusWord(server)}
        </p>
      </header>
      {server.state === "failed" ? (
        <p className="text-sm text-deny wrap-anywhere">
          {server.error ?? "failed"}
          {server.retry_seconds == null ? "" : ` · retry in ${formatSeconds(server.retry_seconds)}`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {restart === undefined ? null : (
          <Button size="sm" onClick={start}>
            {restart.label}
          </Button>
        )}
        <Button size="sm" onClick={() => setTab("test")}>
          Test
        </Button>
        {session === undefined ? null : (
          <Button size="sm" onClick={() => press(session)}>
            {session.action.kind === "session" && session.action.on ? "Turn on in this chat" : "Turn off in this chat"}
          </Button>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`More actions for ${server.name}`}>
              <span aria-hidden="true">⋯</span>
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            {more.map((choice) => (
              <MenuItem key={choice.label} onSelect={() => press(choice)}>
                {choice.label}
              </MenuItem>
            ))}
            {more.length > 0 && removable ? <MenuSeparator /> : null}
            {removable ? (
              <MenuItem className="text-deny" onSelect={() => setRemoving(true)}>
                Remove
              </MenuItem>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
      <p role="status" aria-live="polite" className="font-mono text-xs text-muted empty:hidden">
        {shownNotice}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex flex-col gap-4">
        <TabsList aria-label={`${server.name} details`}>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="try">Try a tool</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          {editable ? <TabsTrigger value="edit">Edit</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="tools">
          {running ? (
            <ToolsTab
              server={server}
              sessionId={sessionId}
              tools={tools}
              onTry={(name) => {
                setTrying(name);
                setTab("try");
              }}
            />
          ) : (
            <NotRunning server={server} sessionId={sessionId} onStart={start} />
          )}
        </TabsContent>
        <TabsContent value="try">
          {running ? (
            <TryTab server={server} sessionId={sessionId} tools={tools} chosen={trying} onChoose={setTrying} />
          ) : (
            <NotRunning server={server} sessionId={sessionId} onStart={start} />
          )}
        </TabsContent>
        <TabsContent value="logs">
          <LogsView server={server} sessionId={sessionId} />
        </TabsContent>
        {editable ? (
          <TabsContent value="edit">
            <EditServer server={server} sessionId={sessionId} onCancel={toTools} onSaved={toTools} />
          </TabsContent>
        ) : null}
        <TabsContent value="test">
          <TestView server={server} sessionId={sessionId} onBack={toTools} />
        </TabsContent>
      </Tabs>
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogTitle>Remove {server.name}?</DialogTitle>
          <DialogDescription>
            Its entry leaves <span className="font-mono wrap-anywhere">{shortPath(server.config ?? DEFAULT_FILE, "")}</span>, and the token it stored leaves the Keychain.
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
