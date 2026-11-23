import { useId, useState } from "react";
import { settingsPath } from "../../store/router.ts";
import type { ChatPromptResult } from "../../store/notifications.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";

/** The words for the named parts of the system prompt. Parts with the same words are one part. */
const PART_LABEL: Readonly<Record<string, string>> = {
  instructions: "Instructions",
  memory: "Memory",
  skill_index: "Skills",
  pinned_skills: "Skills",
  mcp_servers: "MCP",
  delegate: "Helpers",
  cite_sources: "Sources",
  plan_first: "Plan",
};
const OTHER_LABEL = "Basics";
const TOOLS_LABEL = "Tools";
const TOOLS_TEXT = "The descriptions of the tools the model can use. They are sent with every chat.";

/** The fill of a part in the bar. Instructions is the clay one: it is the part this page changes. */
const PART_FILL: Readonly<Record<string, string>> = {
  Basics: "bg-line-strong",
  Instructions: "bg-clay",
  Memory: "bg-ctx-user",
  Skills: "bg-ctx-replies",
  MCP: "bg-ctx-summary",
  Helpers: "bg-ctx-results",
  Sources: "bg-ctx-system",
  Plan: "bg-wait",
  Tools: "bg-faint",
};

export type PromptPart = { label: string; text: string; tokens: number };

/** The parts of one `chat.prompt` answer as the bar shows them: in prompt order, same-named ones joined, the tool descriptions last. */
export function promptParts(prompt: ChatPromptResult): PromptPart[] {
  const parts: PromptPart[] = [];
  for (const part of prompt.parts) {
    const label = PART_LABEL[part.name] ?? OTHER_LABEL;
    const found = parts.find((item) => item.label === label);
    if (found === undefined) parts.push({ label, text: part.text, tokens: part.tokens });
    else {
      found.text = `${found.text}\n\n${part.text}`;
      found.tokens += part.tokens;
    }
  }
  if (prompt.tools_tokens > 0) parts.push({ label: TOOLS_LABEL, text: TOOLS_TEXT, tokens: prompt.tools_tokens });
  return parts;
}

/** The tokens of the instructions part: what the lines cost in every chat. */
export function instructionTokens(prompt: ChatPromptResult | undefined): number {
  return prompt?.parts.find((part) => part.name === "instructions")?.tokens ?? 0;
}

const INSTRUCTIONS_LABEL = "Instructions";
const tokens = (count: number): string => count.toLocaleString("en-US");

/** The name of a part as a row says it. */
const rowName = (label: string): string => (label === INSTRUCTIONS_LABEL ? "Your instructions" : label);

/**
 * What the model reads, as one line under the instructions: a thin bar with one segment per part, the total and your share,
 * and `See all of it`. Opened, the parts are rows (your instructions first) and a row opens the part's text.
 * `prompt` is the last answer; it stays while a new one is asked for.
 */
export function PromptPreview({ prompt, error, onNavigate }: { prompt: ChatPromptResult | undefined; error: string | null; onNavigate: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const id = useId();
  // A refused ask keeps the last answer on screen.
  const [last, setLast] = useState(prompt);
  if (prompt !== undefined && prompt !== last) setLast(prompt);
  const shownPrompt = prompt ?? last;
  const parts = shownPrompt === undefined ? [] : promptParts(shownPrompt).sort((a, b) => Number(b.label === INSTRUCTIONS_LABEL) - Number(a.label === INSTRUCTIONS_LABEL));
  const shown = parts.find((part) => part.label === picked);
  const sum = parts.reduce((all, part) => all + part.tokens, 0);
  return (
    <div role="group" aria-label="What the model reads" className="flex min-w-0 flex-col gap-2.5">
      {error === null ? null : (
        <p role="alert" className="px-1 text-sm text-deny wrap-anywhere">
          {error}
        </p>
      )}
      {shownPrompt === undefined ? (
        error === null ? <p className="px-1 text-sm text-muted">loading…</p> : null
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-meta text-muted">
            <div aria-hidden="true" className="flex h-2 min-w-30 flex-1 basis-35 gap-px overflow-hidden rounded-sm bg-sunken">
              {parts.map((part) => (
                <div key={part.label} className={cn("min-w-1", PART_FILL[part.label])} style={{ flexGrow: Math.max(part.tokens, 1), flexBasis: 0 }} />
              ))}
            </div>
            <span>
              The model reads <b className="font-semibold text-ink">{tokens(shownPrompt.total_tokens)}</b> tokens before your message: yours are{" "}
              <b className="font-semibold text-ink">{tokens(instructionTokens(shownPrompt))}</b>.
            </span>
            <Button
              size="sm"
              kind="ghost"
              aria-expanded={open}
              aria-controls={`${id}-parts`}
              onClick={() => {
                setOpen(!open);
              }}
              className="ml-auto font-semibold text-clay-ink"
            >
              {open ? "Hide" : "See all of it"}
            </Button>
          </div>
          {open ? (
            <div id={`${id}-parts`} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3.5">
              <ul aria-label="Parts" className="m-0 flex list-none flex-col gap-1 p-0">
                {parts.map((part) => (
                  <li key={part.label}>
                    <button
                      type="button"
                      aria-pressed={part === shown}
                      onClick={() => {
                        setPicked(part === shown ? null : part.label);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm outline-offset-2 outline-clay focus-visible:outline-2",
                        part.label === INSTRUCTIONS_LABEL ? "border-clay bg-clay-soft font-semibold text-clay-ink" : "border-line bg-bg text-ink aria-pressed:border-line-strong",
                      )}
                    >
                      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-xs", PART_FILL[part.label])} />
                      <span className="flex-1">{rowName(part.label)}</span>
                      {/* eslint-disable-next-line golem/no-font-mono -- a count of tokens, like the numbers in the list above */}
                      <small className="font-mono text-xs text-faint">{tokens(part.tokens)}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {shown === undefined ? null : (
                <pre aria-label={`${rowName(shown.label)}, as the model reads it`} tabIndex={0} className="m-0 max-h-72 overflow-auto rounded-md border border-line bg-code-bg p-2.5 font-mono text-xs whitespace-pre-wrap text-ink-soft wrap-anywhere">
                  {shown.text}
                </pre>
              )}
              <p className="text-sm text-muted">
                Total: <b className="font-medium text-ink">{tokens(sum)}</b> tokens. Before your message, on every call. Rebuilt each time, never stored.
              </p>
              <p className="text-xs text-muted">
                Memory notes are written by golem and you; manage them in{" "}
                <Link href={settingsPath("memory")} onNavigate={onNavigate} className="text-clay-ink underline underline-offset-2">
                  Memory
                </Link>
                .
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
