import { useState } from "react";
import { settingsPath } from "../../store/router.ts";
import type { ChatPromptResult } from "../../store/notifications.ts";
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

/**
 * What the model reads: the parts of its system prompt as one stacked bar with a label and the tokens for
 * each, the total, and the text of the part you pick below. `prompt` is the last answer; it stays while a new one is asked for.
 */
export function PromptPreview({ prompt, error, onNavigate }: { prompt: ChatPromptResult | undefined; error: string | null; onNavigate: (href: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  // A refused ask keeps the last answer on screen.
  const [last, setLast] = useState(prompt);
  if (prompt !== undefined && prompt !== last) setLast(prompt);
  const shownPrompt = prompt ?? last;
  const parts = shownPrompt === undefined ? [] : promptParts(shownPrompt);
  const shown = parts.find((part) => part.label === picked) ?? parts.find((part) => part.label === "Instructions") ?? parts[0];
  const sum = parts.reduce((all, part) => all + part.tokens, 0);
  return (
    <div role="group" aria-label="What the model reads" className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface chat:sticky chat:top-0 chat:w-chat-preview chat:shrink-0">
      <div className="border-b border-line px-3.5 py-2.5">
        <h4 className="text-meta font-medium text-faint">What the model reads</h4>
      </div>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <p className="text-sm text-muted">Before your message, on every call. Rebuilt each time, never stored.</p>
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny wrap-anywhere">
            {error}
          </p>
        )}
        {shownPrompt === undefined ? (
          error === null ? <p className="text-sm text-muted">loading…</p> : null
        ) : (
          <>
            <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-sm border border-line-strong">
              {parts.map((part) => (
                <div key={part.label} className={cn("min-w-1", PART_FILL[part.label])} style={{ width: `${(part.tokens / Math.max(sum, 1)) * 100}%` }} />
              ))}
            </div>
            <ul aria-label="Parts" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {parts.map((part) => (
                <li key={part.label}>
                  <button
                    type="button"
                    aria-pressed={part === shown}
                    onClick={() => {
                      setPicked(part.label);
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs text-ink outline-offset-2 outline-clay focus-visible:outline-2 aria-pressed:border-clay aria-pressed:bg-clay-soft"
                  >
                    <span aria-hidden="true" className={cn("size-2 rounded-xs", PART_FILL[part.label])} />
                    {part.label}
                    <span className="text-muted">{part.tokens}</span>
                  </button>
                </li>
              ))}
            </ul>
            {shown === undefined ? null : (
              <pre aria-label={`${shown.label}, as the model reads it`} tabIndex={0} className="m-0 max-h-72 overflow-auto rounded-md border border-line bg-code-bg p-2.5 font-mono text-xs whitespace-pre-wrap text-ink-soft wrap-anywhere">
                {shown.text}
              </pre>
            )}
            <p className="text-sm text-muted">
              Total: <b className="font-medium text-ink">{shownPrompt.total_tokens}</b> tokens
            </p>
          </>
        )}
        <p className="text-xs text-muted">
          Memory notes are written by golem and you; manage them in{" "}
          <Link href={settingsPath("memory")} onNavigate={onNavigate} className="text-clay-ink underline underline-offset-2">
            Memory
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
