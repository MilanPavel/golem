import type { ToolsState } from "@golem/view";

const BUSY = new Set(["waiting", "installing", "adding"]);

/** What the Ready step says of Tools: the servers added, those still running, those that failed. */
export function toolsSummary(state: ToolsState | null): { text: string; skipped: boolean } {
  if (state === null || state.phase !== "run") return { text: "skipped", skipped: true };
  const titles = (pick: (kind: string) => boolean): string[] => state.rows.filter((row) => pick(row.status.kind)).map((row) => row.title);
  const added = titles((kind) => kind === "added");
  const busy = titles((kind) => BUSY.has(kind));
  const failed = titles((kind) => kind === "failed");
  const parts = [
    added.length === 0 ? null : `${added.join(", ")} · on in every chat`,
    busy.length === 0 ? null : `${busy.join(", ")} still adding`,
    failed.length === 0 ? null : `${failed.join(", ")} failed`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? { text: "skipped", skipped: true } : { text: parts.join(" · "), skipped: false };
}
