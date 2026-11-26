import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

export type Cell = string | number | boolean | null;
export type Rows = readonly (readonly Cell[])[];

function cellText(value: Cell): string {
  if (value === null) return "—";
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/,/g, " ") : String(value);
}

/** Rows of a sample as a table. `columns` names the cells; a row with fewer cells than columns leaves the rest out. */
export function RowsTable({ columns, rows, label, limit }: { columns: readonly { name: string }[]; rows: Rows; label: string; limit?: number }) {
  const shownRows = limit === undefined ? rows : rows.slice(0, limit);
  const shown = columns.slice(0, Math.max(...shownRows.map((row) => row.length), 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-code">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-line-strong text-left text-faint">
            {shown.map((column) => (
              <th key={column.name} scope="col" className="px-2 py-1 font-normal">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownRows.map((row, at) => (
            <tr key={at} className="border-b border-line text-muted">
              {row.map((value, index) => (
                <td key={index} className={cn("px-2 py-1", typeof value === "number" && "text-right")}>
                  <Code tone="inherit">{cellText(value)}</Code>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
