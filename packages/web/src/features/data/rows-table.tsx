import { fileName, withoutSingleFile } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

export type Cell = string | number | boolean | null;
export type Rows = readonly (readonly Cell[])[];

/** A text cell is cut at this width. The whole value is in its `title`, and shows in full when the cell has focus. */
const CELL_WIDTH = "max-w-64";
/** Text shorter than this fits the width, so it needs no title and no tab stop. */
const SHORT_TEXT = 24;

function cellText(value: Cell): string {
  if (value === null) return "—";
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/,/g, " ") : String(value);
}

/** Rows of a sample as a table, one line a row. `columns` names the cells; a row with fewer cells than columns leaves the rest out. */
export function RowsTable({ columns, rows, label, limit }: { columns: readonly { name: string; min?: string | null | undefined; max?: string | null | undefined }[]; rows: Rows; label: string; limit?: number }) {
  const kept = withoutSingleFile(columns, limit === undefined ? rows : rows.slice(0, limit));
  const shownRows = kept.rows as Cell[][];
  const shown = kept.columns.slice(0, Math.max(...shownRows.map((row) => row.length), 0));
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-line">
      <table className="w-full border-collapse text-code">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="text-left text-faint">
            {shown.map((column, index) => (
              <th key={column.name} scope="col" className={cn("sticky top-0 border-b border-line-strong bg-surface px-2 py-1 font-normal", index === 0 ? "left-0 z-20" : "z-10")}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownRows.map((row, at) => (
            <tr key={at} className="border-b border-line text-muted last:border-b-0">
              {row.map((value, index) => {
                const full = cellText(value);
                const isFile = shown[index]?.name === "file" && typeof value === "string";
                const text = isFile ? fileName(full) : full;
                const long = typeof value === "string" && (full.length > SHORT_TEXT || isFile);
                return (
                  <td key={index} className={cn("whitespace-nowrap px-2 py-1", typeof value === "number" && "text-right", index === 0 && "sticky left-0 bg-bg")}>
                    <Code
                      tone="inherit"
                      title={long ? full : undefined}
                      tabIndex={long ? 0 : undefined}
                      className={cn("block truncate outline-offset-2 outline-clay focus-visible:outline-2", typeof value === "string" && CELL_WIDTH, long && "focus:max-w-none focus:overflow-visible focus:whitespace-normal")}
                    >
                      {text}
                    </Code>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
