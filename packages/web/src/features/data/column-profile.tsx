import { useEffect, useState } from "react";
import { COLUMNS_CAPTION, factsText, typeText, withoutSingleFile, type ViewCell } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { dataErrorText, isDataMissing, type DataColumnProfile, type DataProfileResult, type DataTable } from "../../store/data.ts";
import { EmptyMeter, ShapeChart } from "./profile-charts.tsx";

/** What the profile of one table is doing. */
type Profile = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; profile: DataProfileResult };

const LIST_COLUMNS = "9rem 5.5rem 15rem 1fr 8.5rem";
const CARD_COLUMNS = "repeat(auto-fill, minmax(15.5rem, 1fr))";

/** Reads the profile of a table when it is shown, and again when the description of the source changes. */
function useProfile(table: string, refresh: unknown, load: (table: string) => Promise<DataProfileResult>, first?: DataProfileResult): Profile {
  const [found, setFound] = useState<{ key: string; profile: Profile } | null>(first === undefined ? null : { key: table, profile: { state: "ready", profile: first } });
  const key = `${table}`;
  useEffect(() => {
    let live = true;
    load(table).then(
      (profile) => {
        if (live) setFound({ key, profile: { state: "ready", profile } });
      },
      (failure: unknown) => {
        if (live) setFound({ key, profile: { state: "error", message: isDataMissing(failure) ? "Column charts need a newer golem. Update golem to see them." : dataErrorText(failure, "Could not read the columns.") } });
      },
    );
    return () => {
      live = false;
    };
    // `refresh` is the description: a new one means the source changed.
  }, [table, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return found !== null && found.key === key ? found.profile : { state: "loading" };
}

type Layout = "list" | "cards";

/** A state to start in, for the gallery and the tests. */
export interface ColumnProfileInitial {
  layout?: Layout;
  profile?: DataProfileResult;
}

function LayoutSwitch({ layout, onLayout }: { layout: Layout; onLayout: (layout: Layout) => void }) {
  return (
    <div role="radiogroup" aria-label="Show columns as" className="flex rounded-lg bg-sunken p-0.5">
      {(["list", "cards"] as const).map((each) => (
        <button
          key={each}
          type="button"
          role="radio"
          aria-checked={layout === each}
          onClick={() => onLayout(each)}
          className={cn("rounded-md px-2.5 py-1 text-xs outline-offset-2 outline-clay focus-visible:outline-2", layout === each ? "bg-surface text-ink ring-1 ring-line-strong ring-inset" : "text-muted hover:text-ink")}
        >
          {each === "list" ? "List" : "Cards"}
        </button>
      ))}
    </div>
  );
}

function present(rows: number, column: DataColumnProfile): number {
  return Math.round(rows * (1 - column.empty));
}

function ListRow({ column, rows, onPick }: { column: DataColumnProfile; rows: number; onPick: (column: string, value: ViewCell) => void }) {
  return (
    <li className="grid items-center gap-4 border-b border-line px-3 py-2 hover:bg-surface" style={{ gridTemplateColumns: LIST_COLUMNS }}>
      <Code className="truncate" title={column.name}>
        {column.name}
      </Code>
      <Code tone="inherit" className="text-xs text-faint">
        {typeText(column.type)}
      </Code>
      <ShapeChart column={column} present={present(rows, column)} onPick={onPick} />
      <Code tone="muted">{factsText(column)}</Code>
      <EmptyMeter empty={column.empty} />
    </li>
  );
}

function Card({ column, rows, onPick }: { column: DataColumnProfile; rows: number; onPick: (column: string, value: ViewCell) => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-baseline gap-2">
        <Code className="min-w-0 truncate" title={column.name}>
          {column.name}
        </Code>
        <Code tone="inherit" className="text-xs text-faint">
          {typeText(column.type)}
        </Code>
        <span className="ml-auto">
          <EmptyMeter empty={column.empty} />
        </span>
      </div>
      <ShapeChart column={column} present={present(rows, column)} onPick={onPick} />
      <Code tone="muted">{factsText(column)}</Code>
    </li>
  );
}

/**
 * The Columns tab of one table: a small chart for each column, as a list or as cards. A click on a bar of a
 * category opens the rows with that value. The profile is for your screen only and no model reads it.
 */
export function ColumnProfile({ table, refresh, onLoadProfile, onPick, initial }: { table: DataTable; refresh: unknown; onLoadProfile: (table: string) => Promise<DataProfileResult>; onPick: (column: string, value: ViewCell) => void; initial?: ColumnProfileInitial }) {
  const [layout, setLayout] = useState<Layout>(initial?.layout ?? "list");
  const profile = useProfile(table.name, refresh, onLoadProfile, initial?.profile);
  // The file column is left out when every row is from one file, as in the rows.
  const shown = new Set(withoutSingleFile(table.columns ?? [], []).columns.map((column) => column.name));
  const columns = profile.state === "ready" ? profile.profile.columns.filter((column) => shown.size === 0 || shown.has(column.name)) : [];
  const rows = profile.state === "ready" ? profile.profile.rows : 0;
  const hiddenFile = (table.columns ?? []).some((column) => column.name === "file") && !shown.has("file");
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-meta font-medium text-faint">{COLUMNS_CAPTION}</h2>
        <div className="ml-auto">
          <LayoutSwitch layout={layout} onLayout={setLayout} />
        </div>
      </div>
      {profile.state === "loading" ? (
        <p role="status" className="text-sm text-muted">
          Reading the columns.
        </p>
      ) : profile.state === "error" ? (
        <p role="alert" className="text-sm text-deny">
          {profile.message}
        </p>
      ) : layout === "list" ? (
        <div className="flex flex-col">
          <div aria-hidden="true" className="grid items-center gap-4 border-b border-line-strong px-3 py-1 text-xs text-faint" style={{ gridTemplateColumns: LIST_COLUMNS }}>
            {["column", "type", "shape", "facts", "empty"].map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <ul aria-label={`Columns of ${table.name}`}>
            {columns.map((column) => (
              <ListRow key={column.name} column={column} rows={rows} onPick={onPick} />
            ))}
          </ul>
        </div>
      ) : (
        <ul aria-label={`Columns of ${table.name}`} className="grid gap-3" style={{ gridTemplateColumns: CARD_COLUMNS }}>
          {columns.map((column) => (
            <Card key={column.name} column={column} rows={rows} onPick={onPick} />
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">
        {hiddenFile ? "The file column is hidden because the source is one file. " : ""}Counts are exact up to a million rows; above that, golem estimates them and puts ~ in front. Click a bar to open Rows filtered to that value.
      </p>
    </section>
  );
}
