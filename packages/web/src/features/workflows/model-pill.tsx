import { useState } from "react";
import type { WorkflowModelInfo } from "../../store/workflows.ts";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";

/** What the pill says: the model written in the file, or golem's default model and the one it is now. */
export function modelPillText(info: WorkflowModelInfo): string {
  const written = info.model ?? null;
  const now = info.now ?? null;
  if (written !== null) return `${written} · set in the file`;
  return now === null ? "golem's default model · none set up yet" : `golem's default model · now ${now}`;
}

/** The note under the list: what a step with no model of its own gets, and what a step's own model does. */
export function modelPillHelp(info: WorkflowModelInfo): string {
  const first = info.model === null || info.model === undefined ? "No model is written in the file, so model steps use golem's default model (Settings › Models)." : "Written in the file, in @workflow(model=…).";
  return `${first} Every model step uses it, unless the step names its own. The list is the models you have set up.`;
}

/**
 * The model of a workflow, in the header of the editor (mock § Which model). It is the `model=` of `@workflow(...)`:
 * picking a model writes that argument into the text, as an unsaved edit like any other change.
 */
export function WorkflowModelPill({ info, models, onPick }: { info: WorkflowModelInfo; models: readonly string[]; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const listed = info.model !== null && info.model !== undefined && !models.includes(info.model) ? [info.model, ...models] : models;
  const missing = info.ready === false;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Model of this workflow"
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2"
      >
        <span>Model</span>
        <Code tone="inherit" className={cn("min-w-0 truncate font-medium", missing ? "text-deny" : "text-ink")}>
          {modelPillText(info)}
        </Code>
        {missing ? <span className="text-deny">· not set up here</span> : null}
        <span aria-hidden="true">▾</span>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Model of this workflow" className="flex w-80 flex-col gap-1 max-sm:w-72">
        <p className="px-1 text-meta font-medium text-faint">The model of this workflow</p>
        {listed.length === 0 ? <p className="px-1 py-1.5 text-sm text-muted">No model is set up yet. Set one up in Settings › Models.</p> : null}
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {listed.map((name) => (
            <li key={name}>
              <button
                type="button"
                aria-pressed={info.model === name}
                onClick={() => {
                  setOpen(false);
                  if (info.model !== name) onPick(name);
                }}
                className={cn("flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2", info.model === name ? "bg-sunken" : undefined)}
              >
                <Code tone="inherit" className="min-w-0 flex-1 truncate">
                  {name}
                </Code>
                {info.model === name ? <span className="text-meta text-faint">written</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-1 pt-2 text-meta text-faint">{modelPillHelp(info)}</p>
      </PopoverContent>
    </Popover>
  );
}
