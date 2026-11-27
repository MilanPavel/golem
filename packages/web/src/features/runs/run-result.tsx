import { EMPTY_RESULT_WORDS, resultKind, stepLabel, stepOutputLine, whatItDid } from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { WorkflowReadOutputResult, WorkflowRunInfo, WorkflowStepInfo } from "../../store/workflows.ts";
import { Code } from "../../ui/code.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { Markdown } from "../chat/markdown-view.tsx";
import { ResultActions } from "./result-actions.tsx";
import { RAW_TEXT, ReadableRawSwitch, ResultView } from "./result-view.tsx";

/** One result a run marked, or, with no marked result, what the run returned. `index` is the place in `outputs`, or null for the return value. */
export type RunOutput = { index: number | null; title: string; summary: string | null; value: unknown };

/** The results of a run in order. A run that marked none shows its return value when it has one. */
export function runOutputs(run: Pick<WorkflowRunInfo, "outputs" | "result">): RunOutput[] {
  const marked = run.outputs ?? [];
  const many = marked.length > 1;
  const shown = marked.map((output, index): RunOutput => ({ index, title: output.title ?? (many ? `Result ${index + 1}` : "Result"), summary: output.summary ?? null, value: output.value }));
  const nonEmpty = shown.filter((output) => resultKind(output.value) !== "empty");
  if (nonEmpty.length > 0) return nonEmpty;
  return resultKind(run.result) === "empty" ? [] : [{ index: null, title: "Result", summary: null, value: run.result }];
}

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith(".md");

type FileState = { index: number; status: "error"; reason: string } | { index: number; status: "ready"; file: WorkflowReadOutputResult };

/** An output that is a file path: its text from `workflow.read_output`, as Markdown for a `.md` file. Says when the file was cut. */
function FileOutput({ path, index, label, onReadOutput }: { path: string; index: number; label: string; onReadOutput: (index: number) => Promise<WorkflowReadOutputResult> }) {
  const [answer, setAnswer] = useState<FileState | null>(null);
  // An answer for another output is no answer: the file of this one is still being read.
  const state: FileState | { status: "loading" } = answer !== null && answer.index === index ? answer : { status: "loading" };
  const [raw, setRaw] = useState(false);
  // The caller may pass a new function each render: the file is read again only for another output.
  const read = useRef(onReadOutput);
  useEffect(() => {
    read.current = onReadOutput;
  });
  useEffect(() => {
    let current = true;
    read.current(index).then(
      (file) => current && setAnswer({ index, status: "ready", file }),
      (error: unknown) => current && setAnswer({ index, status: "error", reason: actionErrorText(error, "The file could not be read.") }),
    );
    return () => {
      current = false;
    };
  }, [index]);
  const where = (
    <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 text-meta">
      <span className="text-faint">File</span>
      <Code className="min-w-0 break-all">{path.trim()}</Code>
    </div>
  );
  if (state.status === "loading") {
    return (
      <div role="group" aria-label={label} className="flex flex-col gap-2">
        {where}
        <p className="m-0 text-meta text-muted">Reading the file.</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="group" aria-label={label} className="flex flex-col gap-2">
        {where}
        <p className="m-0 text-meta text-muted">{state.reason}</p>
      </div>
    );
  }
  const { file } = state;
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      {where}
      <ReadableRawSwitch raw={raw} onChange={setRaw} />
      {raw || !isMarkdown(file.path) ? (
        <pre className={RAW_TEXT}>{file.text}</pre>
      ) : (
        <div className="max-h-96 max-w-prose overflow-auto">
          <Markdown text={file.text} />
        </div>
      )}
      {file.truncated ? (
        <p role="status" className="m-0 text-meta text-wait">
          This is the start of the file: it is cut here and is {file.size.toLocaleString()} bytes in all. Open the file to read the rest.
        </p>
      ) : null}
    </div>
  );
}

function OutputBody({ output, runId, onReadOutput, onAskAbout }: { output: RunOutput; runId: string; onReadOutput: (index: number) => Promise<WorkflowReadOutputResult>; onAskAbout?: (text: string) => void }) {
  const label = `Result: ${output.title}`;
  const { index } = output;
  return (
    <div className="flex flex-col gap-2">
      {output.summary === null ? null : <p className="m-0 text-sm text-muted">{output.summary}</p>}
      {resultKind(output.value) === "file" && index !== null ? <FileOutput key={`${runId}:${index}`} path={output.value as string} index={index} label={label} onReadOutput={onReadOutput} /> : <ResultView result={output.value} label={label} />}
      <ResultActions title={output.title} value={output.value} onAskAbout={onAskAbout} />
    </div>
  );
}

/** "What it did", for a run that marked no result: what its notify, review and tool steps did. */
function WhatItDid({ steps, working, ended }: { steps: readonly WorkflowStepInfo[]; working: boolean; ended: boolean }) {
  const did = whatItDid(steps);
  return (
    <div role="group" aria-label="What it did" className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-medium">What it did</h3>
      {did.length === 0 ? (
        <p className="m-0 text-meta text-muted">{working ? "Working. What it did shows here as the steps finish." : ended ? "The run ended before it had anything to show." : EMPTY_RESULT_WORDS}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {did.map((step) => (
            <li key={step.key} className="flex min-w-0 flex-col text-sm">
              <span className="font-medium">{stepLabel(step)}</span>
              <span className="min-w-0 break-words text-meta text-muted">{stepOutputLine(step)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type RunResultProps = {
  run: WorkflowRunInfo;
  steps: readonly WorkflowStepInfo[];
  onReadOutput: (index: number) => Promise<WorkflowReadOutputResult>;
  /** Starts a new chat with this text in its box. Without it "Ask about this" is not offered. */
  onAskAbout?: (text: string) => void;
};

/**
 * What the run came out with, drawn by its kind (text, a record, a table, a file, a link, changes): the first
 * result open and, when it marked several, the others as tabs. With none, what its steps did.
 */
export function RunResult({ run, steps, onReadOutput, onAskAbout }: RunResultProps) {
  const outputs = runOutputs(run);
  const [tab, setTab] = useState("0");
  if (outputs.length === 0) return <WhatItDid steps={steps} working={run.status === "running" || run.status === "pending" || run.status === "waiting"} ended={run.status === "failed" || run.status === "cancelled"} />;
  if (outputs.length === 1) return <OutputBody output={outputs[0]!} runId={run.workflow_run_id} onReadOutput={onReadOutput} onAskAbout={onAskAbout} />;
  const open = outputs[Number(tab)] === undefined ? "0" : tab;
  return (
    <Tabs value={open} onValueChange={setTab} className="flex flex-col gap-3">
      <TabsList aria-label="Results of the run">
        {outputs.map((output, at) => (
          <TabsTrigger key={at} value={String(at)}>
            {output.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {outputs.map((output, at) => (
        <TabsContent key={at} value={String(at)}>
          <OutputBody output={output} runId={run.workflow_run_id} onReadOutput={onReadOutput} onAskAbout={onAskAbout} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
