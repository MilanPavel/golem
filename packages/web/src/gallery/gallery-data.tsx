import { useState } from "react";
import { AddForm, DataPanel, SourcePage, type AddFormInitial, type NotesView } from "../features/data/index.ts";
import {
  SAMPLE_BANK,
  SAMPLE_BANK_DESCRIBED,
  SAMPLE_BROKEN,
  SAMPLE_BUILTIN,
  SAMPLE_BUILTIN_DESCRIBED,
  SAMPLE_DATA_LIST,
  SAMPLE_DEV_DESCRIBED,
  SAMPLE_FOLDER,
  SAMPLE_INSPECT_FILES,
  SAMPLE_INSPECT_PG,
  SAMPLE_LOGS,
  SAMPLE_PROD_DESCRIBED,
  SAMPLE_SHOP_DEV,
  SAMPLE_SHOP_PROD,
} from "../features/data/sample.ts";
import { SidebarPanel } from "../features/sidebar/index.ts";
import type { DataAnswer, DataDescribeResult, DataListResult, DataSource } from "../store/data.ts";
import type { DataTab } from "../store/router.ts";

const NOTES_READY: NotesView = { state: "ready", text: "# bank\n\nMy bank's CSV exports, one file a month.\n\n- amount < 0 is money out.\n- \"SALARY ACME\" is my salary.\n", path: "~/.golem/data/bank.md" };

function Story({ title, theme, source, described, tab, notes = NOTES_READY, describeMissing = false }: { title: string; theme: string; source: DataSource; described: DataDescribeResult | null; tab: DataTab; notes?: NotesView; describeMissing?: boolean }) {
  const [shown, setShown] = useState(tab);
  return (
    <div className="mt-4 rounded-lg border border-line bg-bg p-5" role="region" aria-label={`${title}, ${theme}`}>
      <SourcePage
        source={source}
        described={described}
        describeMissing={describeMissing}
        notes={notes}
        tab={shown}
        onTab={setShown}
        onAsk={() => {}}
        onRun={() => {}}
        onLoadSample={() => Promise.resolve([["4210", "dev+4210@example.test", 2]])}
        onSaveNotes={() => Promise.resolve("~/.golem/data/bank.md")}
        onDraftNotes={() => Promise.resolve("# bank\n\nDrafted from the schema.\n")}
        onPrivacy={() => Promise.resolve()}
        onWatch={() => Promise.resolve()}
        onRemove={() => Promise.resolve()}
      />
    </div>
  );
}

const STORIES: readonly [string, DataSource, DataDescribeResult | null, DataTab, { notes?: NotesView; describeMissing?: boolean }?][] = [
  ["Source, rows open", SAMPLE_SHOP_DEV, SAMPLE_DEV_DESCRIBED, "tables"],
  ["Source, rows local", SAMPLE_BANK, SAMPLE_BANK_DESCRIBED, "tables"],
  ["Source, schema only", SAMPLE_SHOP_PROD, SAMPLE_PROD_DESCRIBED, "tables"],
  ["Source, not trusted", SAMPLE_LOGS, { source: SAMPLE_LOGS, tables: [], sample: {} }, "tables"],
  ["Source, could not be read", SAMPLE_BROKEN, { source: SAMPLE_BROKEN, tables: [], sample: {} }, "tables"],
  ["Source, notes", SAMPLE_BANK, SAMPLE_BANK_DESCRIBED, "notes"],
  ["Source, notes, not available yet", SAMPLE_BANK, SAMPLE_BANK_DESCRIBED, "notes", { notes: { state: "missing" } }],
  ["Source, queries", SAMPLE_BANK, SAMPLE_BANK_DESCRIBED, "queries"],
  ["Source, queries, none", SAMPLE_SHOP_DEV, SAMPLE_DEV_DESCRIBED, "queries"],
  ["Source, settings", SAMPLE_BANK, SAMPLE_BANK_DESCRIBED, "settings"],
  ["Source, settings, built in", SAMPLE_BUILTIN, SAMPLE_BUILTIN_DESCRIBED, "settings"],
  ["Source, not available yet", SAMPLE_BANK, null, "tables", { describeMissing: true }],
];

const DIALOGS: readonly [string, AddFormInitial][] = [
  ["Add dialog, kind", {}],
  ["Add dialog, kind, MCP", { kind: "mcp" }],
  ["Add dialog, files, checked", { step: "where", kind: "files", path: "~/Documents/bank/*.csv", check: { state: "ok", location: "~/Documents/bank/*.csv", result: SAMPLE_INSPECT_FILES } }],
  ["Add dialog, files, checking", { step: "where", kind: "files", path: "~/Documents/bank/*.csv", check: { state: "checking", location: "~/Documents/bank/*.csv" } }],
  ["Add dialog, files, not found", { step: "where", kind: "files", path: "~/Documents/bnak/*.csv", check: { state: "error", location: "~/Documents/bnak/*.csv", message: "No files match ~/Documents/bnak/*.csv." } }],
  [
    "Add dialog, database, tested",
    { step: "where", kind: "database", address: "postgres://golem_ro@localhost:5432/shop_dev", scope: "project", check: { state: "ok", location: "postgres://golem_ro@localhost:5432/shop_dev", result: SAMPLE_INSPECT_PG } },
  ],
  ["Add dialog, privacy, files", { step: "privacy", kind: "files", path: "~/Documents/bank/*.csv", check: { state: "ok", location: "~/Documents/bank/*.csv", result: SAMPLE_INSPECT_FILES } }],
  [
    "Add dialog, privacy, database, add failed",
    {
      step: "privacy",
      kind: "database",
      address: "postgres://golem_ro@localhost:5432/shop_dev",
      scope: "project",
      check: { state: "ok", location: "postgres://golem_ro@localhost:5432/shop_dev", result: SAMPLE_INSPECT_PG },
      error: "password authentication failed for user \"golem_ro\"",
    },
  ],
];

const PANELS: readonly [string, DataAnswer<DataListResult> | null, string | null][] = [
  ["Data", { status: "ready", data: SAMPLE_DATA_LIST }, SAMPLE_BANK.name],
  ["Data, empty", { status: "ready", data: { sources: [] } }, null],
  ["Data, loading", null, null],
  ["Data, not available yet", { status: "missing" }, null],
];

/** The Data section of the gallery: the panel, the source page's tabs, and the three steps of the add dialog. */
export function DataGallery({ theme, id }: { theme: string; id: string }) {
  return (
    <section className="mt-6" id={id}>
      <h3 className="mb-2 font-mono text-xs text-faint">Data</h3>
      <div className="flex flex-wrap gap-4">
        {PANELS.map(([label, answer, selected]) => (
          <div key={label} className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel title="Data" label={`${label}, ${theme}`} onHide={() => {}}>
              <DataPanel answer={answer} folder={SAMPLE_FOLDER} selected={selected} onNavigate={() => {}} onAdd={() => {}} />
            </SidebarPanel>
          </div>
        ))}
      </div>
      {STORIES.map(([title, source, described, tab, extra]) => (
        <Story key={title} title={title} theme={theme} source={source} described={described} tab={tab} {...extra} />
      ))}
      <div className="mt-4 flex flex-wrap items-start gap-4">
        {DIALOGS.map(([title, initial]) => (
          <div key={title} role="region" aria-label={`${title}, ${theme}`} className="w-full max-w-2xl rounded-lg border border-line bg-surface p-5 text-ink shadow-soft">
            <AddForm
              inline
              folder={SAMPLE_FOLDER}
              onInspect={() => new Promise(() => {})}
              onAdd={() => new Promise(() => {})}
              onAdded={() => {}}
              onCancel={() => {}}
              onOpenMcp={() => {}}
              initial={initial}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
