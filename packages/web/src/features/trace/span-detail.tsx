import { Fragment, useState, type ComponentType, type ReactNode } from "react";
import type { TraceMessage, TraceSpanResult } from "../../store/trace.ts";
import { Button } from "../../ui/button.tsx";
import { writeClipboard } from "../../ui/clipboard.ts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { Markdown } from "../chat/index.ts";
import { ArtifactDialog } from "./artifact-dialog.tsx";
import { formatDuration } from "./format.ts";
import {
  callLine,
  copyText,
  FOLD_LINES,
  jsonText,
  labelOf,
  metadataRows,
  modelLine,
  NOT_RECORDED_LINE,
  showValue,
  TAB_LABEL,
  tabsOf,
  toolNames,
  type Mode,
  type Tab,
} from "./span-text.ts";

/** What opens a call's whole output. The gallery passes a stand-in, as it has no daemon to read from. */
export type ArtifactViewer = ComponentType<{ sessionId: string; artifactId: string; open: boolean; onOpenChange: (open: boolean) => void }>;

const BLOCK = "overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-code-bg p-3 font-mono text-xs";

function NotRecorded() {
  return <p className="text-sm text-faint">{NOT_RECORDED_LINE}</p>;
}

/** A closed row that opens into its body. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-sm border border-line">
      <summary className="cursor-pointer px-3 py-1.5 text-sm text-muted outline-offset-2 outline-clay focus-visible:outline-2">{title}</summary>
      <div className="border-t border-line p-3">{children}</div>
    </details>
  );
}

function schemaName(schema: Record<string, unknown>, index: number): string {
  const fn = schema["function"];
  const inner = fn !== null && typeof fn === "object" ? (fn as Record<string, unknown>)["name"] : undefined;
  const name = inner ?? schema["name"];
  return typeof name === "string" ? name : `tool ${index + 1}`;
}

/** A tool result in its block, closed after `FOLD_LINES` lines. */
function FoldedBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const [all, setAll] = useState(false);
  const folded = !all && lines.length > FOLD_LINES;
  return (
    <div>
      <pre className={BLOCK}>{folded ? lines.slice(0, FOLD_LINES).join("\n") : text}</pre>
      {folded ? (
        <Button kind="ghost" size="sm" className="mt-1" onClick={() => setAll(true)}>
          Show all {lines.length} lines
        </Button>
      ) : null}
    </div>
  );
}

function MessageRow({ message, names }: { message: TraceMessage; names: ReadonlyMap<string, string> }) {
  const calls = message.tool_calls ?? [];
  return (
    <li className="flex gap-3">
      <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs text-faint">{labelOf(message, names)}</span>
      <div className="min-w-0 flex-1 text-sm">
        {message.role === "tool" ? (
          <FoldedBlock text={message.text} />
        ) : (
          <>
            {message.text === "" ? null : <Markdown text={message.text} />}
            {calls.map((call, index) => (
              <p key={index} className="font-mono text-xs text-muted">
                {callLine(call)}
              </p>
            ))}
          </>
        )}
      </div>
    </li>
  );
}

function Messages({ messages, newFrom, names }: { messages: readonly TraceMessage[]; newFrom: number | null; names: ReadonlyMap<string, string> }) {
  return (
    <ul aria-label="Messages" className="flex flex-col gap-3">
      {messages.map((message, index) => (
        <Fragment key={message.id ?? index}>
          {index === newFrom && index > 0 ? (
            <li className="flex items-center gap-2 text-xs text-faint">
              <span aria-hidden="true" className="h-px flex-1 bg-line" />
              new since the last call
              <span aria-hidden="true" className="h-px flex-1 bg-line" />
            </li>
          ) : null}
          <MessageRow message={message} names={names} />
        </Fragment>
      ))}
    </ul>
  );
}

function Context({ result }: { result: TraceSpanResult }) {
  const messages = result.messages ?? [];
  const names = toolNames(messages);
  const prompt = result.system_prompt;
  const tools = result.tools;
  return (
    <div className="flex flex-col gap-3">
      {prompt === null || prompt === undefined ? (
        <NotRecorded />
      ) : (
        <Fold title={`System prompt · ${prompt.length.toLocaleString("en-US")} characters`}>
          <pre className={BLOCK}>{prompt}</pre>
        </Fold>
      )}
      {tools === null || tools === undefined ? null : (
        <Fold title={`Tools · ${tools.length}`}>
          <div className="flex flex-col gap-2">
            {tools.map((tool, index) => (
              <Fold key={index} title={schemaName(tool, index)}>
                <pre className={BLOCK}>{JSON.stringify(tool, null, 2)}</pre>
              </Fold>
            ))}
          </div>
        </Fold>
      )}
      {messages.length === 0 ? <p className="text-sm text-faint">No messages.</p> : <Messages messages={messages} newFrom={result.new_from ?? null} names={names} />}
    </div>
  );
}

function Reply({ result }: { result: TraceSpanResult }) {
  if (!result.reply) return <p className="text-sm text-faint">There is no reply: the call did not finish.</p>;
  const names = toolNames(result.messages ?? []);
  return (
    <ul aria-label="Reply" className="flex flex-col gap-3">
      <MessageRow message={result.reply} names={names} />
    </ul>
  );
}

function Pairs({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-faint">{label}</dt>
          <dd className="min-w-0 break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Metadata({ result }: { result: TraceSpanResult }) {
  return (
    <div className="flex flex-col gap-3">
      {result.span.recorded === false ? <NotRecorded /> : null}
      <Pairs rows={metadataRows(result)} />
    </div>
  );
}

function Args({ result }: { result: TraceSpanResult }) {
  const entries = Object.entries(result.args ?? {});
  if (entries.length === 0) return <p className="text-sm text-faint">No arguments.</p>;
  return <Pairs rows={entries.map(([key, value]) => [key, showValue(value)] as const)} />;
}

function Result({ result, sessionId, Artifact }: { result: TraceSpanResult; sessionId: string; Artifact: ArtifactViewer }) {
  const [open, setOpen] = useState(false);
  const artifact = result.artifact_id;
  return (
    <div className="flex flex-col gap-2">
      {result.result === null || result.result === undefined ? <p className="text-sm text-faint">No result was recorded.</p> : <FoldedBlock text={result.result} />}
      {artifact === null || artifact === undefined ? null : (
        <>
          <p className="text-sm text-muted">The output was too big for the model, so only the start went back to it.</p>
          <div>
            <Button size="sm" onClick={() => setOpen(true)}>
              Open full output
            </Button>
          </div>
          <Artifact sessionId={sessionId} artifactId={artifact} open={open} onOpenChange={setOpen} />
        </>
      )}
    </div>
  );
}

function Approval({ result }: { result: TraceSpanResult }) {
  const approval = result.approval ?? {};
  const rows: [string, string][] = [];
  rows.push(["decision", showValue(approval["decision"])]);
  if (approval["rule"] !== null && approval["rule"] !== undefined) rows.push(["rule", showValue(approval["rule"])]);
  if (approval["subject"] !== null && approval["subject"] !== undefined) rows.push(["subject", showValue(approval["subject"])]);
  if (result.span.approval_wait_ms !== null && result.span.approval_wait_ms !== undefined) rows.push(["waited", formatDuration(result.span.approval_wait_ms)]);
  const edited = approval["args"];
  return (
    <div className="flex flex-col gap-3">
      <Pairs rows={rows} />
      {edited !== null && typeof edited === "object" ? (
        <div>
          <p className="mb-1 text-xs text-faint">Edited arguments</p>
          <pre className={BLOCK}>{JSON.stringify(edited, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function Pretty({ tab, result, sessionId, Artifact }: { tab: Tab; result: TraceSpanResult; sessionId: string; Artifact: ArtifactViewer }) {
  switch (tab) {
    case "context":
      return <Context result={result} />;
    case "reply":
      return <Reply result={result} />;
    case "metadata":
      return <Metadata result={result} />;
    case "args":
      return <Args result={result} />;
    case "result":
      return <Result result={result} sessionId={sessionId} Artifact={Artifact} />;
    case "approval":
      return <Approval result={result} />;
  }
}

function Header({ result }: { result: TraceSpanResult }) {
  const { span } = result;
  return (
    <header className="flex flex-col gap-0.5 border-b border-line px-4 py-2.5">
      <h2 className="flex items-baseline gap-2 text-base font-medium">
        {span.kind === "model" ? <span aria-hidden="true" className="text-clay">◆</span> : null}
        {span.kind === "tool" ? <span aria-hidden="true" className="text-muted">⚙</span> : null}
        <span className={span.kind === "tool" ? "font-mono text-sm" : ""}>{span.kind === "run" ? `Run · ${span.name}` : span.name}</span>
        {span.kind === "tool" ? (
          <>
            {span.status === "ok" ? <span className="text-allow"><span aria-hidden="true">✓</span><span className="sr-only">ok</span></span> : null}
            {span.status === "failed" ? <span className="text-deny"><span aria-hidden="true">✗</span><span className="sr-only">failed</span></span> : null}
            {span.status !== "ok" && span.status !== "failed" ? <span className="text-xs text-muted">{span.status}</span> : null}
          </>
        ) : null}
      </h2>
      <p className="font-mono text-xs text-muted">
        {span.kind === "model"
          ? modelLine(result)
          : span.kind === "tool"
            ? [formatDuration(span.duration_ms), span.approval_wait_ms ? `waited ${formatDuration(span.approval_wait_ms)} for approval` : null].filter(Boolean).join(" · ")
            : [span.status, formatDuration(span.duration_ms)].join(" · ")}
      </p>
    </header>
  );
}

/** The body of a tab: Pretty or JSON, with the switch and Copy at the top right. */
function Panel({ tab, result, sessionId, Artifact, mode, setMode }: { tab: Tab; result: TraceSpanResult; sessionId: string; Artifact: ArtifactViewer; mode: Mode; setMode: (mode: Mode) => void }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  function copy(): void {
    void writeClipboard(copyText(result, tab, mode)).then(
      () => {
        setCopied("done");
        window.setTimeout(() => setCopied("idle"), 2000);
      },
      () => setCopied("failed"),
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-end gap-2">
        <div role="group" aria-label="Format" className="flex gap-0.5">
          <Button kind={mode === "pretty" ? "secondary" : "ghost"} size="sm" aria-pressed={mode === "pretty"} onClick={() => setMode("pretty")}>
            Pretty
          </Button>
          <Button kind={mode === "json" ? "secondary" : "ghost"} size="sm" aria-pressed={mode === "json"} onClick={() => setMode("json")}>
            JSON
          </Button>
        </div>
        <Button kind="ghost" size="sm" onClick={copy}>
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
        </Button>
      </div>
      {mode === "json" ? <pre className={BLOCK}>{jsonText(result, tab)}</pre> : <Pretty tab={tab} result={result} sessionId={sessionId} Artifact={Artifact} />}
    </div>
  );
}

/**
 * What one span took in and gave out: its header, then tabs. A model call has Context, Reply and
 * Metadata; a tool has Args, Result, and Approval when the call had one. A run has no input or
 * output of its own.
 */
export function SpanDetail({ result, sessionId, Artifact = ArtifactDialog }: { result: TraceSpanResult; sessionId: string; Artifact?: ArtifactViewer }) {
  // Pretty or JSON stays as chosen while the tabs change, and starts again with the next span.
  const [mode, setMode] = useState<Mode>("pretty");
  const tabs = tabsOf(result);
  const first = tabs[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Header result={result} />
      {first === undefined ? (
        <p className="p-4 text-sm text-faint">A run has no input or output of its own. Select a model call or a tool.</p>
      ) : (
        // The key starts a new span on its first tab.
        <Tabs key={result.span.id} defaultValue={first} className="flex flex-col">
          <TabsList aria-label="Span" className="px-4">
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {TAB_LABEL[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab} value={tab}>
              <Panel tab={tab} result={result} sessionId={sessionId} Artifact={Artifact} mode={mode} setMode={setMode} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
