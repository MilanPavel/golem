import { type BenchUpdate, type GolemClient, MODEL_NOT_CONFIGURED, RpcError } from "@golem/client";
import type { ModelBenchDone } from "../../protocol/gen/model-bench-done.ts";
import type { ModelBenchRow } from "../../protocol/gen/model-bench-row.ts";

import { checkHeader } from "./models-check.ts";

export type BenchClient = Pick<GolemClient, "benchModel" | "onBench">;

export const NO_LOCAL_MODEL = "no local model: nothing to measure here";
export const IDLE_NOTE = "The numbers are only right on an idle machine: stop other work that uses the model.";

const HEADERS = ["at once", "each (tokens/s)", "total (tokens/s)", "window each"];

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cells(row: ModelBenchRow): string[] {
  return [String(row.at_once), mean(row.each).toFixed(1), row.total.toFixed(1), String(row.window)];
}

/** One row as it arrives: `tools · 2 at once · 29.8 tokens/s each · 59.5 total · window 8192 each`. */
export function formatBenchRow(row: ModelBenchRow): string {
  const [atOnce, each, total, window] = cells(row);
  return `${row.shape} · ${atOnce} at once · ${each} tokens/s each · ${total} total · window ${window} each`;
}

function grid(rows: ModelBenchRow[]): string[] {
  const body = rows.map(cells);
  const widths = HEADERS.map((header, column) => Math.max(header.length, ...body.map((line) => (line[column] ?? "").length)));
  const line = (parts: string[]): string =>
    parts
      .map((part, column) => part.padStart(widths[column] ?? 0))
      .join("   ")
      .trimEnd();
  return [line(HEADERS), ...body.map(line)];
}

/** The table: at once, each, total, window each. One block per shape when there are two. */
export function formatBenchTable(rows: ModelBenchRow[]): string {
  const shapes = [...new Set(rows.map((row) => row.shape))];
  if (shapes.length <= 1) {
    return grid(rows).join("\n");
  }
  return shapes.map((shape) => [shape, ...grid(rows.filter((row) => row.shape === shape))].join("\n")).join("\n\n");
}

function finished(done: ModelBenchDone): ModelBenchRow[] {
  return done.rows ?? [];
}

/** `golem models check --parallel [--engine <id>] <ref>`: print each row as it ends, then the table. */
export async function runModelsBench(
  client: BenchClient,
  name: string,
  engine: string | undefined,
  write: (line: string) => void,
  error: (line: string) => void,
): Promise<number> {
  const seen: BenchUpdate[] = [];
  let follow: ((update: BenchUpdate) => void) | undefined;
  const off = client.onBench((update) => {
    if (follow === undefined) {
      seen.push(update);
    } else {
      follow(update);
    }
  });
  try {
    let started;
    try {
      started = await client.benchModel(name, engine);
    } catch (caught) {
      if (caught instanceof RpcError && caught.code === MODEL_NOT_CONFIGURED) {
        // A hosted ref and a setup with no local model get the fixed line. Any other refusal
        // (an unknown engine, a model that does not run here) is printed in the daemon's words.
        const none = /is not a local model|no local model to measure/.test(caught.message);
        error(none ? NO_LOCAL_MODEL : caught.message);
        return 1;
      }
      throw caught;
    }
    if (!started.started) {
      error(`${checkHeader(started.ref)} is already being measured`);
      return 1;
    }
    write(checkHeader(started.ref));
    write(IDLE_NOTE);
    const done = await new Promise<ModelBenchDone>((resolve) => {
      follow = (update) => {
        if (update.kind === "progress" && update.progress.ref === started.ref) {
          write(formatBenchRow(update.progress.row));
        } else if (update.kind === "done" && update.done.ref === started.ref) {
          resolve(update.done);
        }
      };
      for (const update of seen) {
        follow(update);
      }
    });
    const rows = finished(done);
    if (!done.ok) {
      error(done.error ?? "the measurement stopped");
      if (rows.length > 0) {
        error("rows that finished:");
        error(formatBenchTable(rows));
      }
      return 1;
    }
    write("");
    write(formatBenchTable(rows));
    return 0;
  } finally {
    off();
  }
}
