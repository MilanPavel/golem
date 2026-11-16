import type { CheckUpdate, GolemClient } from "@golem/client";
import type { ModelCheckCase } from "../../protocol/gen/model-check-case.ts";
import type { ModelCheckDone } from "../../protocol/gen/model-check-done.ts";

export type CheckClient = Pick<GolemClient, "checkModel" | "onCheck">;

const MARKS: Record<ModelCheckCase["outcome"], string> = { pass: "✓", recovered: "~", fail: "✗" };
const VERDICTS: Record<NonNullable<ModelCheckDone["verdict"]>, string> = {
  reliable: "tool calls look reliable",
  usable: "usable; golem will step up when it fails",
  not_recommended: "not recommended for tool work",
};
const TITLE_WIDTH = 22;

/** `qwen3:27b on this Mac` for a local model, the ref for a hosted one. */
export function checkHeader(ref: string): string {
  return ref.startsWith("ollama/") ? `${ref.slice("ollama/".length)} on this Mac` : ref;
}

/** One line per case: mark, title, time, and what went wrong or was recovered. */
export function formatCheckCase(item: ModelCheckCase): string {
  const seconds = `${(item.ms / 1000).toFixed(1)} s`;
  const note = item.detail === null || item.detail === undefined ? "" : `   ${item.detail}`;
  return `${MARKS[item.outcome]} ${item.title.padEnd(TITLE_WIDTH)} ${seconds.padStart(6)}${note}`.trimEnd();
}

/** `8 of 10 passed · 1 recovered · tool calls look reliable`, and the cost of a hosted model. */
export function formatCheckSummary(done: ModelCheckDone): string {
  const parts = [`${done.passed ?? 0} of ${done.total ?? 0} passed`];
  if ((done.recovered ?? 0) > 0) {
    parts.push(`${done.recovered} recovered`);
  }
  if (done.verdict !== null && done.verdict !== undefined) {
    parts.push(VERDICTS[done.verdict]);
  }
  if (done.cost_usd !== null && done.cost_usd !== undefined && done.cost_usd > 0) {
    parts.push(`cost about $${done.cost_usd < 0.01 ? "0.01" : done.cost_usd.toFixed(2)}`);
  }
  return parts.join(" · ");
}

/** `golem models check <model>`: print each case as it ends, then the verdict. */
export async function runModelsCheck(
  client: CheckClient,
  name: string,
  write: (line: string) => void,
  error: (line: string) => void,
): Promise<number> {
  const seen: CheckUpdate[] = [];
  let follow: ((update: CheckUpdate) => void) | undefined;
  const off = client.onCheck((update) => {
    if (follow === undefined) {
      seen.push(update);
    } else {
      follow(update);
    }
  });
  try {
    const started = await client.checkModel(name);
    write(checkHeader(started.ref));
    const done = await new Promise<ModelCheckDone>((resolve) => {
      follow = (update) => {
        if (update.kind === "progress" && update.progress.ref === started.ref) {
          write(formatCheckCase(update.progress.result));
        } else if (update.kind === "done" && update.done.ref === started.ref) {
          resolve(update.done);
        }
      };
      for (const update of seen) {
        follow(update);
      }
    });
    if (!done.ok) {
      error(done.error ?? "the check stopped");
      return 1;
    }
    write(formatCheckSummary(done));
    return 0;
  } finally {
    off();
  }
}
