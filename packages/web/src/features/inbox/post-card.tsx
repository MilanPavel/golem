import { formatCell, inboxPostMeta, inboxPostMore, inboxPostTime, type ResultCell } from "@golem/view";
import type { InboxPost } from "../../store/routines.ts";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { cn } from "../../ui/cn.ts";

/** How many rows a post shows. The daemon keeps at most this many. */
const SHOWN = 10;

export type InboxPostCardProps = {
  post: InboxPost;
  /** The line a failed Done left, if any. */
  error?: string | undefined;
  onOpenQuery: (post: InboxPost) => void;
  onAsk: (post: InboxPost) => void;
  onDone: (post: InboxPost) => void;
};

/**
 * What a query routine left: its name, the row count and the source, the first rows as a table, and the actions
 * Open the query, Ask in chat and Done. A failed run shows the engine's words in place of the rows.
 */
export function InboxPostCard({ post, error, onOpenQuery, onAsk, onDone }: InboxPostCardProps) {
  const columns = post.columns ?? [];
  const rows = post.rows ?? [];
  const failed = post.error !== undefined && post.error !== null;
  const more = inboxPostMore(post, rows.length);
  const time = inboxPostTime(post.at);
  return (
    <li className="rounded-lg border border-line-strong bg-surface p-3" data-inbox-post={post.post_id}>
      <p className="flex items-baseline gap-2 text-sm leading-snug">
        <span aria-hidden="true" className={cn("h-2 w-2 flex-none self-center rounded-full", failed ? "bg-deny" : "bg-wait")} />
        <span className="min-w-0 truncate font-medium">{post.routine}</span>
        <span className="min-w-0 truncate text-xs text-faint">· {inboxPostMeta(post)}</span>
        {time === "" ? null : <span className="ml-auto flex-none text-meta text-faint">{time}</span>}
      </p>
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-deny wrap-anywhere whitespace-pre-wrap">
          {post.error}
        </p>
      ) : columns.length === 0 ? null : (
        <div role="group" aria-label={`The first rows of ${post.saved}`} tabIndex={0} className="mt-2 max-h-56 overflow-auto rounded-md border border-line outline-offset-2 outline-clay focus-visible:outline-2">
          <table className="w-full border-collapse text-code">
            <thead className="sticky top-0 bg-sunken">
              <tr className="border-b border-line-strong">
                {columns.map((column, index) => (
                  <th key={index} scope="col" className="px-2 py-1 text-left font-normal text-muted">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN).map((row, at) => (
                <tr key={at} className="border-b border-line">
                  {columns.map((_column, index) => {
                    const value = (row as readonly unknown[])[index] ?? null;
                    const cell = formatCell(value as ResultCell);
                    return (
                      <td key={index} className={cn("px-2 py-1 whitespace-nowrap", cell.kind === "null" ? "text-faint" : "text-ink-soft", typeof value === "number" ? "text-right tabular-nums" : "text-left")}>
                        <Code tone="inherit">{cell.text}</Code>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more === null || failed ? null : <p className="mt-1 text-meta text-faint">{more}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          aria-label={`Open the query, ${post.saved}`}
          onClick={() => {
            onOpenQuery(post);
          }}
        >
          Open the query
        </Button>
        <Button
          size="sm"
          aria-label={`Ask in chat, ${post.routine}`}
          onClick={() => {
            onAsk(post);
          }}
        >
          Ask in chat
        </Button>
        <Button
          size="sm"
          kind="ghost"
          aria-label={`Done, ${post.routine}`}
          onClick={() => {
            onDone(post);
          }}
        >
          Done
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="mt-2 text-xs text-deny wrap-anywhere">
          {error}
        </p>
      )}
    </li>
  );
}
