import { keyGroups, savedCount, type KeyRow, type KeyServer } from "@golem/view";
import { useId, useMemo, useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { AuthKeyStatus } from "../../store/keys.ts";
import { useKeys, useMcpCatalog, useMcpList, useNavigate } from "../../store/page-context.tsx";
import { settingsPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { ChevronDownIcon, CpuIcon, LockIcon, PlugIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { ProviderIcon } from "../../ui/provider-icons.tsx";
import { useSettingsContext } from "./context.ts";
import { requestMcpOpen } from "./mcp-open-request.ts";
import { brandPath } from "./mcp/brand-icon.tsx";

/**
 * Where each key is kept, from `auth.list`: in the environment, in the Keychain, or missing, in two
 * groups: model providers and MCP servers. The page never sees a key and cannot set or remove one
 * (ADR-028), so there is no input here, only commands to copy.
 */
export function KeysSection() {
  const sessionId = useSettingsContext()?.sessionId ?? null;
  const navigate = useNavigate();
  // The query reads again when the section opens, when the link comes back, and when the tab is seen again.
  const keys = useKeys();
  const servers = useMcpList(sessionId);
  const catalog = useMcpCatalog(sessionId);
  const known = useMemo<KeyServer[]>(() => {
    const titles = new Map((catalog.data?.entries ?? []).map((entry) => [entry.name, entry.title]));
    return (servers.data?.servers ?? []).map((server) => ({ name: server.name, title: titles.get(server.name) }));
  }, [servers.data, catalog.data]);
  if (keys.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(keys.error, "Could not read where the keys are.")}
        </p>
        <Button size="sm" onClick={() => void keys.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  // The server names decide which row belongs to which server, so the page waits for them (a failure leaves the rows plain).
  if (keys.data === undefined || servers.isPending) {
    return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  }
  return (
    <KeysView
      providers={keys.data.providers}
      servers={known}
      refreshing={keys.isFetching}
      onRefresh={() => void keys.refetch()}
      onNavigate={navigate}
      onServer={requestMcpOpen}
    />
  );
}

export type KeysViewProps = {
  providers: readonly AuthKeyStatus[];
  /** The MCP servers the page knows, to tell which one a ref belongs to. */
  servers: readonly KeyServer[];
  refreshing?: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  /** A `Server` link was pressed: the section opens that server's details once the MCP tab shows. */
  onServer: (name: string) => void;
  /** The row whose Replace and Remove commands start open. The gallery uses it. */
  initialOpen?: string | null;
};

/** The page: its head, the two groups, and the note that keys are never typed here. */
export function KeysView({ providers, servers, refreshing = false, onRefresh, onNavigate, onServer, initialOpen = null }: KeysViewProps) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const groups = keyGroups(providers, servers);
  const all = savedCount([...groups.models, ...groups.mcp]);
  const mcpPath = settingsPath("mcp");
  const toggle = (ref: string): void => {
    setOpen(open === ref ? null : ref);
  };
  return (
    <div className="flex max-w-column flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="max-w-prose min-w-0 flex-1 text-sm text-muted">
          Keys for cloud models and for MCP servers that need a token. Golem keeps them in the macOS Keychain or reads them from its environment.
        </p>
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs text-faint">
            {all.saved} of {all.total} saved
          </span>
          <Button size="sm" disabled={refreshing} onClick={onRefresh}>
            Refresh
          </Button>
        </span>
      </div>
      <KeyGroup title="Model providers" glyph={<CpuIcon className="size-3.5" />} purpose="for cloud models · optional when you run on Ollama" rows={groups.models}>
        {(rows) => <KeyList label="Model providers" rows={rows} open={open} onToggle={toggle} onServer={onServer} onNavigate={onNavigate} />}
      </KeyGroup>
      <KeyGroup
        title="MCP servers"
        glyph={<PlugIcon className="size-3.5" />}
        purpose="tokens the tool servers sign in with"
        rows={groups.mcp}
        empty={
          <>
            <span>No MCP server needs a key. Servers that ask for a token show up here once added.</span>
            <Link
              href={mcpPath}
              onNavigate={onNavigate}
              className="font-medium text-clay-ink underline decoration-clay-ink/40 underline-offset-4 outline-offset-2 outline-clay focus-visible:outline-2"
            >
              MCP servers →
            </Link>
          </>
        }
      >
        {(rows) => <KeyList label="MCP servers" rows={rows} open={open} onToggle={toggle} onServer={onServer} onNavigate={onNavigate} />}
      </KeyGroup>
      <p className="flex items-start gap-2.5 rounded-md bg-sunken px-3.5 py-3 text-sm text-muted">
        <LockIcon className="mt-0.5 shrink-0 text-faint" />
        <span>Keys are set and removed in a terminal. This page never sees, stores or sends one; it only shows where each key is.</span>
      </p>
    </div>
  );
}

/** A group's heading (a glyph tile, the title, its purpose, `n of m saved`) and its list, or a dashed box when it has no rows. */
function KeyGroup({
  title,
  glyph,
  purpose,
  rows,
  empty,
  children,
}: {
  title: string;
  glyph: ReactNode;
  purpose: string;
  rows: readonly KeyRow[];
  empty?: ReactNode;
  children: (rows: readonly KeyRow[]) => ReactNode;
}) {
  const count = savedCount(rows);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="inline-grid size-5.5 place-items-center rounded-sm bg-sunken text-muted">
            {glyph}
          </span>
          {title}
        </h3>
        <span className="text-sm text-muted">{purpose}</span>
        {rows.length === 0 ? null : (
          <span className="ml-auto font-mono text-xs text-faint">
            <b className="font-medium text-allow">{count.saved}</b> of {count.total} saved
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">{empty}</div>
      ) : (
        children(rows)
      )}
    </div>
  );
}

function KeyList({
  label,
  rows,
  open,
  onToggle,
  onServer,
  onNavigate,
}: {
  label: string;
  rows: readonly KeyRow[];
  open: string | null;
  onToggle: (ref: string) => void;
  onServer: (name: string) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map((row) => (
        <KeyItem key={row.ref} row={row} open={open === row.ref} onToggle={onToggle} onServer={onServer} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

const PILL = "inline-flex items-center gap-1.5 rounded-full px-2 py-px text-xs font-medium whitespace-nowrap";

/** One key: its mark, name, blurb and status; where it is kept; and the command to set it, or the drawer of Replace and Remove. */
function KeyItem({
  row,
  open,
  onToggle,
  onServer,
  onNavigate,
}: {
  row: KeyRow;
  open: boolean;
  onToggle: (ref: string) => void;
  onServer: (name: string) => void;
  onNavigate: (path: string) => void;
}) {
  const drawer = useId();
  const mcp = row.server !== null;
  const path = mcp ? brandPath(row.server ?? "") : null;
  const serverLink =
    row.serverKnown && row.server !== null ? (
      <ServerLink
        name={row.server}
        href={settingsPath("mcp")}
        onNavigate={(href) => {
          onServer(row.server ?? "");
          onNavigate(href);
        }}
      />
    ) : null;
  return (
    <li className="flex flex-col gap-2 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md border",
            row.saved ? "border-transparent bg-allow-soft text-allow" : "border-line bg-sunken text-muted",
          )}
        >
          {mcp ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" focusable="false">
              {path === null ? (
                <text x="12" y="18" textAnchor="middle" fontSize="17" fontWeight="600" fontFamily="inherit">
                  {row.name.charAt(0).toUpperCase()}
                </text>
              ) : (
                <path d={path} />
              )}
            </svg>
          ) : (
            <ProviderIcon provider={row.ref} name={row.name} width="18" height="18" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold wrap-anywhere">{row.name}</span>
            <small className="text-sm text-muted">{row.blurb}</small>
            <span className={cn(PILL, row.saved ? "bg-allow-soft text-allow" : "bg-wait-soft text-wait")}>
              <i aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {row.saved ? "saved" : "missing"}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-faint">
            {row.source === "keychain" ? (
              <>
                <LockIcon className="size-3" /> in the Keychain
              </>
            ) : row.source === "env" ? (
              <>from ${row.envVar ?? "the environment"}</>
            ) : mcp ? (
              <span className="wrap-anywhere">{row.ref}</span>
            ) : (
              "not set"
            )}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {row.saved ? (
            <>
              {serverLink}
              <button
                type="button"
                aria-expanded={open}
                aria-controls={drawer}
                aria-label={`Replace or remove the ${row.name} key`}
                onClick={() => {
                  onToggle(row.ref);
                }}
                className="grid size-7 place-items-center rounded-sm text-faint outline-offset-2 outline-clay hover:bg-sunken hover:text-ink focus-visible:outline-2 aria-expanded:bg-sunken aria-expanded:text-ink"
              >
                <ChevronDownIcon className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
              </button>
            </>
          ) : (
            <>
              {serverLink}
              <CopyCommand command={row.setCommand} />
            </>
          )}
        </span>
      </div>
      {row.saved && open ? (
        <div id={drawer} className="flex flex-col gap-2 border-t border-dashed border-line-strong pt-2.5 pl-12.5 text-sm text-muted">
          <DrawerLine label="Replace">
            <CopyCommand command={row.setCommand} />
          </DrawerLine>
          {row.removeCommand === null ? (
            <DrawerLine label="Source">
              <span>
                Set by <code className="rounded-sm bg-code-bg px-1 font-mono text-xs">${row.envVar ?? "the variable"}</code> in the daemon&apos;s environment. Unset it there to remove.
              </span>
            </DrawerLine>
          ) : (
            <DrawerLine label="Remove">
              <CopyCommand command={row.removeCommand} />
            </DrawerLine>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ServerLink({ name, href, onNavigate }: { name: string; href: string; onNavigate: (href: string) => void }) {
  return (
    <Link
      href={href}
      onNavigate={onNavigate}
      aria-label={`${name} on the MCP servers tab`}
      className="text-sm font-medium text-clay-ink underline decoration-clay-ink/40 underline-offset-4 outline-offset-2 outline-clay focus-visible:outline-2"
    >
      Server
    </Link>
  );
}

function DrawerLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="w-16 font-mono text-xs font-medium tracking-wide text-faint uppercase">{label}</span>
      {children}
    </div>
  );
}
