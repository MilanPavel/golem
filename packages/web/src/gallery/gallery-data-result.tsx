import type { ToolTable } from "@golem/client";
import { ExtensionRow } from "../features/data/extension-row.tsx";
import { ResultTable, type ResultTableInitial } from "../features/data/result-table.tsx";
import {
  SAMPLE_BIG_PAGE_TWO,
  SAMPLE_BIG_RESULT,
  SAMPLE_EMPTY_RESULT,
  SAMPLE_SPEND_BY_MONTH,
  SAMPLE_SPEND_BY_NAME,
  SAMPLE_SUBSCRIPTIONS,
  SAMPLE_TRUNCATED_RESULT,
} from "../features/data/result-sample.ts";

const NEVER = () => new Promise<never>(() => {});

const STORIES: readonly [string, ToolTable, { withheld?: boolean; initial?: ResultTableInitial; paging?: boolean }?][] = [
  ["Result, table", SAMPLE_SUBSCRIPTIONS],
  ["Result, paged", SAMPLE_BIG_RESULT, { paging: true, initial: { page: SAMPLE_BIG_PAGE_TWO } }],
  ["Result, sorted", SAMPLE_SUBSCRIPTIONS, { initial: { sort: { column: 3, descending: true } } }],
  ["Result, chart bar", SAMPLE_SPEND_BY_NAME, { initial: { view: "chart" } }],
  ["Result, chart line", SAMPLE_SPEND_BY_MONTH, { initial: { view: "chart" } }],
  ["Result, rows withheld", SAMPLE_SUBSCRIPTIONS, { withheld: true, initial: { showStub: true } }],
  ["Result, truncated", SAMPLE_TRUNCATED_RESULT, { paging: true }],
  ["Result, empty", SAMPLE_EMPTY_RESULT],
  ["Result, page failed", SAMPLE_BIG_RESULT, { paging: true, initial: { error: "That result is no longer kept. Run the query again." } }],
];

/** The Data result section of the gallery: a `data_query` table in a chat, and the add-on download row. */
export function DataResultGallery({ theme, id }: { theme: string; id: string }) {
  return (
    <section className="mt-6" id={id}>
      <h3 className="mb-2 font-mono text-xs text-faint">Data result</h3>
      <div className="flex flex-wrap items-start gap-4">
        {STORIES.map(([title, table, extra]) => (
          <div key={title} role="region" aria-label={`${title}, ${theme}`} className="w-full max-w-3xl rounded-lg border border-line bg-surface p-3 text-ink">
            <ResultTable table={table} rowsWithheld={extra?.withheld === true} {...(extra?.paging === true ? { onPage: NEVER } : {})} {...(extra?.initial === undefined ? {} : { initial: extra.initial })} />
          </div>
        ))}
        <div role="region" aria-label={`Add-on to download, ${theme}`} className="w-full max-w-3xl rounded-lg border border-line bg-surface p-3 text-ink">
          <ExtensionRow name="excel" onInstall={NEVER} />
        </div>
      </div>
    </section>
  );
}
