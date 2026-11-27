import type { ReactNode } from "react";
import { EditQueryForm, SaveQueryForm } from "../features/data/query-dialogs.tsx";
import { QueriesTab } from "../features/data/queries-tab.tsx";
import { ResultTable } from "../features/data/result-table.tsx";
import { SAMPLE_NOW, SAMPLE_QUERIES, SAMPLE_QUERY_RESULT, SAMPLE_SAVABLE_RESULT, SAMPLE_TRIED_ROWS } from "../features/data/queries-sample.ts";
import { QueryRoutinesFrames } from "./gallery-query-routines.tsx";
import { SAMPLE_BANK } from "../features/data/sample.ts";

const NEVER = () => new Promise<never>(() => {});
const OK = () => Promise.resolve();

function Frame({ title, theme, wide = false, children }: { title: string; theme: string; wide?: boolean; children: ReactNode }) {
  return (
    <div role="region" aria-label={`${title}, ${theme}`} className={`w-full rounded-lg border border-line bg-surface p-4 text-ink ${wide ? "max-w-3xl" : "max-w-xl"}`}>
      {children}
    </div>
  );
}

const THIRD = SAMPLE_QUERIES[2];

/** The saved-queries section of the gallery: Save query on a chat result and its dialog, the Queries tab with a run open, the New and Edit dialog, and the empty tab. */
export function DataQueriesGallery({ theme, id }: { theme: string; id: string }) {
  return (
    <section className="mt-6" id={id}>
      <h3 className="mb-2 font-mono text-xs text-faint">Data saved queries</h3>
      <div className="flex flex-wrap items-start gap-4">
        <Frame title="Save query, on a chat result" theme={theme} wide>
          <ResultTable table={SAMPLE_SAVABLE_RESULT} onPage={NEVER} save={{ scope: "user", question: "How much did I spend each month this year?", onSave: OK }} />
        </Frame>
        <Frame title="Save dialog" theme={theme}>
          <SaveQueryForm inline source="bank" scope="user" sql={SAMPLE_SAVABLE_RESULT.sql ?? ""} suggested="Spending by month" initial={{ description: "Money out per month this year, card and transfers, refunds left out" }} onSave={OK} onClose={() => {}} />
        </Frame>
        <Frame title="Save dialog, name taken" theme={theme}>
          <SaveQueryForm inline source="bank" scope="project" sql={SAMPLE_SAVABLE_RESULT.sql ?? ""} suggested="Spending by month" initial={{ taken: true }} onSave={OK} onClose={() => {}} />
        </Frame>
        <Frame title="Queries tab, a run open" theme={theme} wide>
          <QueriesTab
            source={SAMPLE_BANK}
            queries={SAMPLE_QUERIES}
            now={SAMPLE_NOW}
            onRun={NEVER}
            onTry={NEVER}
            onAsk={() => {}}
            onSave={OK}
            onRemove={OK}
            onPage={NEVER}
            onExport={NEVER}
            initial={{ ran: { "Spending by month": { table: SAMPLE_QUERY_RESULT, ms: 38 } } }}
          />
        </Frame>
        <Frame title="Queries tab, with routines" theme={theme} wide>
          <QueriesTab
            source={SAMPLE_BANK}
            queries={SAMPLE_QUERIES}
            now={SAMPLE_NOW}
            onRun={NEVER}
            onTry={NEVER}
            onAsk={() => {}}
            onSave={OK}
            onRemove={OK}
            routines={{
              routineOf: (saved) => (saved === SAMPLE_QUERIES[0]?.name ? { name: "spending", schedule: "0 8 * * 1", query: { source: "bank", saved }, post: "always" } : undefined),
              names: ["spending"],
              create: OK,
              open: () => {},
            }}
          />
        </Frame>
        <Frame title="Queries tab, remove asked" theme={theme} wide>
          <QueriesTab source={SAMPLE_BANK} queries={SAMPLE_QUERIES.slice(1)} now={SAMPLE_NOW} onRun={NEVER} onTry={NEVER} onAsk={() => {}} onSave={OK} onRemove={OK} initial={{ confirming: "Subscriptions" }} />
        </Frame>
        <Frame title="Queries tab, empty" theme={theme} wide>
          <QueriesTab source={SAMPLE_BANK} queries={[]} now={SAMPLE_NOW} onRun={NEVER} onTry={NEVER} onAsk={() => {}} onSave={OK} onRemove={OK} />
        </Frame>
        {THIRD === undefined ? null : (
          <Frame title="Edit dialog, after Try" theme={theme}>
            <EditQueryForm
              inline
              source="bank"
              query={{ ...THIRD, sql: "select booked, description, -amount as paid\nfrom transactions\nwhere amount < -500 and booked >= current_date - 7\norder by paid desc" }}
              onTry={NEVER}
              onSave={OK}
              onRemove={OK}
              onClose={() => {}}
              initial={{ tried: SAMPLE_TRIED_ROWS }}
            />
          </Frame>
        )}
        {THIRD === undefined ? null : (
          <Frame title="Edit dialog, Try failed" theme={theme}>
            <EditQueryForm
              inline
              source="bank"
              query={THIRD}
              onTry={NEVER}
              onSave={OK}
              onRemove={OK}
              onClose={() => {}}
              initial={{ tried: { kind: "error", message: 'Binder Error: Referenced column "amout" not found in FROM clause!\nCandidate bindings: "amount"' } }}
            />
          </Frame>
        )}
        <Frame title="New query dialog" theme={theme}>
          <EditQueryForm inline source="bank" query={null} onTry={NEVER} onSave={OK} onClose={() => {}} />
        </Frame>
        <QueryRoutinesFrames theme={theme} />
      </div>
    </section>
  );
}
