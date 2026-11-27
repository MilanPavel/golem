import type { ComponentProps } from "react";
import { DataPanel } from "../features/data/index.ts";
import { SAMPLE_BANK, SAMPLE_BUILTIN, SAMPLE_FOLDER, SAMPLE_SHOP_DEV } from "../features/data/sample.ts";
import { Rail } from "../features/sidebar/rail.tsx";
import { SidebarPanel } from "../features/sidebar/index.ts";
import type { DataSource } from "../store/data.ts";
import { DuckdbIcon, ExcelBrandIcon, MysqlIcon, ParquetBrandIcon, PostgresIcon, SqliteIcon } from "../ui/data-brand-icons.tsx";
import { CsvIcon, FolderIcon, GlobeIcon, GolemMarkIcon, JsonIcon, ServerDatabaseIcon, SheetIcon } from "../ui/data-icons.tsx";
import { DataIcon, InboxIcon, RoutinesIcon, RunsIcon, SessionsIcon, WorkflowsIcon } from "../ui/icons.tsx";

type Glyph = (props: Omit<ComponentProps<"svg">, "children">) => React.JSX.Element;

const ICONS: readonly [string, Glyph][] = [
  ["Data (rail)", DataIcon],
  ["Built in", GolemMarkIcon],
  ["CSV, TSV", CsvIcon],
  ["Excel", ExcelBrandIcon],
  ["Parquet", ParquetBrandIcon],
  ["JSON", JsonIcon],
  ["Folder or pattern", FolderIcon],
  ["SQLite", SqliteIcon],
  ["DuckDB", DuckdbIcon],
  ["PostgreSQL", PostgresIcon],
  ["MySQL", MysqlIcon],
  ["Database (add dialog)", ServerDatabaseIcon],
  ["URL", GlobeIcon],
  ["Other file", SheetIcon],
  ["Sessions", SessionsIcon],
  ["Inbox", InboxIcon],
  ["Routines", RoutinesIcon],
  ["Workflows", WorkflowsIcon],
  ["Runs", RunsIcon],
];

const base: DataSource = { ...SAMPLE_BANK, privacy: "local", watch: false };
const LIST: readonly DataSource[] = [
  SAMPLE_BUILTIN,
  { ...base, name: "bank", location: "~/Documents/bank/*.csv" },
  { ...base, name: "receipts", location: "~/Documents/receipts/2026.xlsx" },
  { ...base, name: "events", location: "~/data/events.parquet" },
  { ...base, name: "logs", location: "./var/log/*.jsonl" },
  { ...base, name: "exports", location: "~/Documents/exports/" },
  { ...base, name: "archive", kind: "sqlite", location: "~/old/archive.db" },
  { ...base, name: "analytics", kind: "duckdb", location: "~/data/analytics.duckdb" },
  SAMPLE_SHOP_DEV,
  { ...SAMPLE_SHOP_DEV, name: "shop_mysql", kind: "mysql", location: "mysql://golem_ro@localhost:3306/shop" },
  { ...base, name: "prices", kind: "url", location: "https://example.com/prices.csv" },
];

/** The icons of Data: each at 16 and 32 px beside the rail's other icons, the Data panel's rows, and the rail with Data picked. */
export function DataIconsGallery({ theme, id }: { theme: string; id: string }) {
  return (
    <section className="mt-6" id={id}>
      <h3 className="mb-2 font-mono text-xs text-faint">Data icons</h3>
      <div className="flex flex-wrap gap-4">
        <table className="rounded-lg border border-line bg-bg text-sm" aria-label={`Data icons, ${theme}`}>
          <caption className="sr-only">Each icon at 16 and 32 pixels</caption>
          <thead>
            <tr className="text-left font-mono text-xs text-faint">
              <th scope="col" className="px-3 py-2 font-normal">Icon</th>
              <th scope="col" className="px-3 py-2 font-normal">16 px</th>
              <th scope="col" className="px-3 py-2 font-normal">32 px</th>
            </tr>
          </thead>
          <tbody>
            {ICONS.map(([name, Shape]) => (
              <tr key={name} className="text-ink">
                <th scope="row" className="px-3 py-1.5 text-left text-xs font-normal text-muted">{name}</th>
                <td className="px-3 py-1.5"><Shape /></td>
                <td className="px-3 py-1.5"><Shape width={32} height={32} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="h-136 w-67 overflow-hidden rounded-lg border border-line">
          <SidebarPanel title="Data" label={`Data, every kind, ${theme}`} onHide={() => {}}>
            <DataPanel answer={{ status: "ready", data: { sources: [...LIST] } }} folder={SAMPLE_FOLDER} selected="bank" onNavigate={() => {}} onAdd={() => {}} />
          </SidebarPanel>
        </div>
        <div className="h-136 overflow-hidden rounded-lg border border-line">
          <Rail
            state="idle"
            version="0.9.1"
            connected="connected"
            picked="data"
            inboxCount={0}
            settingsDot={false}
            label={`Sidebar rail, Data picked, ${theme}`}
            onPick={() => {}}
            onNew={() => {}}
            onSearch={() => {}}
            onSettings={() => {}}
          />
        </div>
      </div>
    </section>
  );
}
