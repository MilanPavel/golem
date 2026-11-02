import "./diff.css";
import { parseDiff } from "@golem/view";
import { useMemo } from "react";
import { cn } from "../../ui/cn.ts";
import type { DiffMode } from "./diff-mode.ts";
import { diffFile, splitRows, unifiedRows, type Cell, type NoteRow } from "./rows.ts";

const TONE = {
  add: "bg-allow-soft",
  del: "bg-deny-soft",
  context: "",
} as const;

const SIGN = {
  add: "text-allow",
  del: "text-deny",
  context: "text-faint",
} as const;

const NUMBER = "select-none px-2 text-right align-top text-faint";

function Note({ row, span }: { row: NoteRow; span: number }) {
  return (
    <tr data-row={row.kind}>
      <td colSpan={span} className={cn("whitespace-pre px-2 text-muted", row.kind === "hunk" && "bg-sunken")}>
        {row.text}
      </td>
    </tr>
  );
}

function Half({ cell, divider }: { cell: Cell | null; divider: boolean }) {
  const tone = cell ? TONE[cell.tone] : "";
  const edge = divider ? "border-l border-line" : "";
  return (
    <>
      <td className={cn(NUMBER, tone, edge)}>{cell?.n}</td>
      <td className={cn("w-4 select-none text-center align-top", tone, cell ? SIGN[cell.tone] : "")}>{cell?.sign.trim()}</td>
      <td className={cn("pr-3 align-top whitespace-pre-wrap wrap-anywhere text-ink", tone)}>{cell?.text}</td>
    </>
  );
}

/**
 * A unified diff as a table: the line numbers of both files, the sign in its own column, and
 * the text. Long lines scroll sideways. The text is React children, never markup.
 */
export function DiffView({ diff, mode }: { diff: string; mode: DiffMode }) {
  const { file, unified, split } = useMemo(() => {
    const lines = parseDiff(diff);
    return { file: diffFile(lines), unified: unifiedRows(lines), split: splitRows(lines) };
  }, [diff]);
  const isSplit = mode === "split";
  const span = isSplit ? 6 : 4;
  return (
    <div data-diff-mode={mode} className="min-w-0">
      {file.path !== null ? (
        <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
          <span className="wrap-anywhere text-ink">{file.path}</span>
          {file.added ? <span className="rounded-xs bg-allow-soft px-1.5 text-allow">new file</span> : null}
          {file.deleted ? <span className="rounded-xs bg-deny-soft px-1.5 text-deny">deleted</span> : null}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-sm border border-line bg-bg">
        <table className={cn("diff-table border-collapse", isSplit ? "w-full table-fixed" : "w-max min-w-full")}>
          {isSplit ? (
            // Two equal halves: each side's number and sign columns stay narrow, the text takes the rest.
            <colgroup>
              <col className="w-12" />
              <col className="w-5" />
              <col />
              <col className="w-12" />
              <col className="w-5" />
              <col />
            </colgroup>
          ) : null}
          <caption className="sr-only">{file.path === null ? "Change" : `Change to ${file.path}`}</caption>
          <thead className="sr-only">
            <tr>
              {isSplit ? (
                <>
                  <th scope="col">Old line</th>
                  <th scope="col">Change</th>
                  <th scope="col">Old text</th>
                  <th scope="col">New line</th>
                  <th scope="col">Change</th>
                  <th scope="col">New text</th>
                </>
              ) : (
                <>
                  <th scope="col">Old line</th>
                  <th scope="col">New line</th>
                  <th scope="col">Change</th>
                  <th scope="col">Text</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isSplit
              ? split.map((row, i) =>
                  row.kind === "pair" ? (
                    <tr key={i} data-row="pair">
                      <Half cell={row.left} divider={false} />
                      <Half cell={row.right} divider />
                    </tr>
                  ) : (
                    <Note key={i} row={row} span={span} />
                  ),
                )
              : unified.map((row, i) =>
                  row.kind === "line" ? (
                    <tr key={i} data-row={row.tone} className={TONE[row.tone]}>
                      <td className={NUMBER}>{row.old}</td>
                      <td className={NUMBER}>{row.new}</td>
                      <td className={cn("w-4 select-none text-center align-top", SIGN[row.tone])}>{row.sign.trim()}</td>
                      <td className="whitespace-pre pr-3 align-top text-ink">{row.text}</td>
                    </tr>
                  ) : (
                    <Note key={i} row={row} span={span} />
                  ),
                )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
