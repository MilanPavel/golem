import { definitionLines, type AgentRow } from "@golem/view";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { writeClipboard } from "../../ui/clipboard.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { ModelControl } from "./agents-model.tsx";

export type AgentTab = "overview" | "definition";

const NO_FILE = "The daemon did not send this file. Update golem to read it here.";
const COPIED_MS = 2000;

/** The small word beside a name: bundled, yours or project. */
export function OriginMark({ row }: { row: AgentRow }) {
  return <span className={cn("shrink-0 rounded-xs border px-1 text-meta whitespace-nowrap", row.source === "user" ? "border-clay bg-clay-soft text-clay-ink" : "border-line text-muted")}>{row.mark}</span>;
}

/** The "not yet" mark of an agent that cannot be started now. */
export function NotYetMark() {
  return <span className="shrink-0 rounded-xs bg-wait-soft px-1 text-meta whitespace-nowrap text-wait">not yet</span>;
}

function Fact({ title, setting, className, children }: { title: string; setting: string; className?: string; children: ReactNode }) {
  return (
    <section data-setting={setting} aria-label={title} className={cn("flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3", className)}>
      <h4 className="text-meta text-faint">{title}</h4>
      {children}
    </section>
  );
}

function CanUse({ row }: { row: AgentRow }) {
  if (row.readingTools.length + row.changingTools.length === 0) return <p className="text-sm text-muted">None. It works from the brief alone.</p>;
  const chip = "rounded-sm border px-1.5 py-0.5 font-mono text-meta";
  return (
    <>
      <ul aria-label="Tools" className="flex flex-wrap gap-1">
        {row.readingTools.map((tool) => (
          <li key={tool} className={cn(chip, "border-line bg-bg text-muted")}>
            {tool}
          </li>
        ))}
        {row.changingTools.map((tool) => (
          <li key={tool} className={cn(chip, "border-wait bg-wait-soft text-wait")}>
            <span aria-hidden="true">! </span>
            {tool}
            <span className="sr-only"> (changes things)</span>
          </li>
        ))}
      </ul>
      <p className="text-meta text-muted">{row.toolsNote}</p>
    </>
  );
}

/** The Overview: model, tools, limits, the prompt and how much the agent was used. */
export function AgentOverview({ row, onSetWish }: { row: AgentRow; onSetWish: ((name: string, wish: string) => Promise<void>) | undefined }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Fact title="Model" setting="model" className="xl:col-span-2">
          <ModelControl row={row} onSetWish={onSetWish} />
        </Fact>
        <Fact title="Can use" setting="can use">
          <CanUse row={row} />
        </Fact>
        <Fact title="Limits" setting="limits">
          <dl className="grid grid-cols-3 gap-2">
            {row.limits.map((limit) => (
              <div key={limit.label}>
                <dd>
                  <Code>{limit.value}</Code>
                </dd>
                <dt className="text-meta text-muted">{limit.label}</dt>
              </div>
            ))}
          </dl>
          <p className="text-meta text-muted">{row.asksLine}</p>
        </Fact>
        <Fact title="Prompt" setting="prompt" className="xl:col-span-2">
          {row.prompt === null ? <p className="text-sm text-muted">{NO_FILE}</p> : <p className="font-prose text-body leading-relaxed whitespace-pre-wrap text-ink-soft wrap-anywhere">{row.prompt}</p>}
        </Fact>
      </div>
      <p className="text-meta text-muted">{row.usage}</p>
    </div>
  );
}

/** "Copy text": puts the file on the clipboard and says so for a moment; a refusal is a line. */
function CopyText({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const copy = (): void => {
    writeClipboard(text).then(
      () => {
        setState("copied");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setState("idle");
        }, COPIED_MS);
      },
      () => {
        setState("failed");
      },
    );
  };
  return (
    <div className="flex items-center gap-2">
      {state === "failed" ? (
        <span role="alert" className="text-meta text-deny">
          Could not copy. Select the text and copy it.
        </span>
      ) : null}
      <Button size="sm" onClick={copy}>
        {state === "copied" ? "Copied" : "Copy text"}
      </Button>
    </div>
  );
}

/** The Definition: the path, "Copy text", and the file with the keys at its top tinted. */
export function AgentDefinition({ row }: { row: AgentRow }) {
  if (row.text === null) return <p className="text-sm text-muted">{NO_FILE}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {row.definitionPath === null ? <span /> : <Code tone="muted" className="min-w-0 wrap-anywhere">{row.definitionPath}</Code>}
        <CopyText text={row.text} />
      </div>
      <pre
        // The file may be wider than the pane: it scrolls, so the keyboard must be able to reach it.
        tabIndex={0}
        aria-label={`File of ${row.name}`}
        className="overflow-x-auto rounded-lg border border-line bg-code-bg p-4 font-mono text-code whitespace-pre-wrap text-ink outline-offset-2 outline-clay focus-visible:outline-2"
      >
        {definitionLines(row.text).map((line, at) => (
          <span key={at} className="block">
            {line.kind === "fence" ? <span className="text-faint">{line.text}</span> : null}
            {line.kind === "key" ? (
              <>
                <span className="text-clay-ink">{`${line.key}:`}</span>
                {line.text}
              </>
            ) : null}
            {/* A zero-width space keeps an empty line one line high. */}
            {line.kind === "plain" ? line.text || "\u200b" : null}
          </span>
        ))}
      </pre>
      {row.source === "bundled" ? <p className="text-meta text-muted">This file ships with golem and updates with it.</p> : null}
    </div>
  );
}

/**
 * One agent: its head (name, mark, description, and why it cannot run or what is wrong with its file), then the
 * Overview and Definition tabs. Text from the file is shown as text nodes only.
 */
export function AgentDetail({
  row,
  onSetWish,
  showName = true,
}: {
  row: AgentRow;
  onSetWish: ((name: string, wish: string) => Promise<void>) | undefined;
  /** False in a narrow row, where the row above already says the name. */
  showName?: boolean;
}) {
  const [tab, setTab] = useState<AgentTab>("overview");
  const broken = row.tone === "bad";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1">
        {showName ? (
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-ui text-lg font-semibold wrap-anywhere">{row.name}</h3>
            <OriginMark row={row} />
            {row.unavailable === null ? null : <NotYetMark />}
          </div>
        ) : null}
        {row.description === "" ? null : <p className="max-w-prose text-sm text-muted wrap-anywhere">{row.description}</p>}
        {row.unavailable === null ? null : (
          <p role="note" className="w-fit max-w-prose rounded-md bg-wait-soft px-2.5 py-1 text-meta text-wait">
            {row.unavailable}
          </p>
        )}
        {row.warnings.map((text) => (
          <p key={text} role="note" className={cn("text-meta wrap-anywhere", broken ? "text-deny" : "text-muted")}>
            {text}
          </p>
        ))}
      </header>
      <Tabs value={tab} onValueChange={(next) => setTab(next as AgentTab)} className="flex flex-col gap-3">
        <TabsList aria-label={`${row.name} details`}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <AgentOverview row={row} onSetWish={onSetWish} />
        </TabsContent>
        <TabsContent value="definition">
          <AgentDefinition row={row} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
