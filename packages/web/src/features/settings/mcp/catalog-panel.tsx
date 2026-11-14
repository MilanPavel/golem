import { entryAvailable, entryInputs, groupEntries, OTHER_ID, type McpCatalogEntry } from "@golem/view";
import { useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import { useMcpCatalog } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { Input } from "../../../ui/input.tsx";
import { BrandIcon } from "./brand-icon.tsx";

/** What a person must give before Add works, in two words, so the card says it up front. */
function needs(entry: McpCatalogEntry): string {
  const kinds = new Set(entryInputs(entry).map((input) => input.kind));
  if (kinds.has("secret")) return "needs token";
  if (kinds.has("path")) return "needs path";
  return "";
}

/** The cards of the servers golem offers, then the card for any other server. Pure: the panel below feeds it. */
export function CatalogView({ entries, onAdd }: { entries: readonly McpCatalogEntry[]; onAdd: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const shown = groupEntries(entries, query).flatMap((group) => group.entries);
  return (
    <div className="flex flex-col gap-3">
      <Input aria-label="Search the list" placeholder="Search servers (filesystem, git, browser…)" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((entry) => {
          const usable = entryAvailable(entry) && entry.added !== true;
          const hint = entry.added === true ? "" : !entryAvailable(entry) ? (entry.reason ?? "Not available.") : needs(entry);
          return (
            <li key={entry.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <BrandIcon id={entry.id} label={entry.title} />
                <h3 className="min-w-0 truncate text-sm font-semibold">{entry.title}</h3>
              </div>
              <p className="flex-1 text-xs text-muted">{entry.description}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-xs text-faint wrap-anywhere">{hint}</span>
                {entry.added === true ? (
                  <span className="font-mono text-xs text-allow">Added</span>
                ) : (
                  <Button size="sm" disabled={!usable} aria-label={`Add ${entry.title}`} onClick={() => onAdd(entry.id)}>
                    Add
                  </Button>
                )}
              </div>
            </li>
          );
        })}
        <li className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong p-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line font-mono text-xs">
              +
            </span>
            <h3 className="text-sm font-semibold">Another server</h3>
          </div>
          <p className="flex-1 text-xs text-muted">A command that runs on this Mac, or an https:// URL.</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-faint">command · URL</span>
            <Button size="sm" aria-label="Add another server" onClick={() => onAdd(OTHER_ID)}>
              Add…
            </Button>
          </div>
        </li>
      </ul>
      {shown.length === 0 ? <p className="text-sm text-muted">Nothing in the list matches “{query}”.</p> : null}
    </div>
  );
}

/** The Catalog tab: what `mcp.catalog` offers. Add opens the form for one. */
export function CatalogPanel({ sessionId, onAdd }: { sessionId: string | null; onAdd: (id: string) => void }) {
  const catalog = useMcpCatalog(sessionId);
  if (catalog.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(catalog.error, "Could not read the list.")}
        </p>
        <Button size="sm" onClick={() => void catalog.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (catalog.data === undefined) {
    return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  }
  return <CatalogView entries={catalog.data.entries} onAdd={onAdd} />;
}
