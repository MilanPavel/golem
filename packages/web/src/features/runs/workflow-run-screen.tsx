import { useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { modelNames } from "@golem/view";
import { useModelList, useNavigate, usePageActions, useStartChatWith, useWorkflowReader, useWorkflowStatus } from "../../store/page-context.tsx";
import { helperPath, sessionPath, workflowPath } from "../../store/router.ts";
import { outlineStepOf } from "../workflows/last-run.tsx";
import { TraceBody, useTraceData } from "../trace/trace-screen.tsx";
import { useNow } from "../sessions/use-now.ts";
import { WorkflowRunView } from "./workflow-run-view.tsx";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div data-screen="run" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      {children}
    </div>
  );
}

/** The trace of the run's session, with the span you picked shown beside the tree. */
function RunTrace({ sessionId }: { sessionId: string }) {
  const [span, setSpan] = useState<string | null>(null);
  const data = useTraceData(sessionId, span);
  return <TraceBody id={sessionId} span={span} data={data} layout="stacked" onSelect={setSpan} />;
}

/** `/runs/:id`: one workflow run, from `workflow.status`. It follows the run's `workflow.run.*` and `workflow.step.*` notifications. */
export function WorkflowRunScreen({ id }: { id: string }) {
  const query = useWorkflowStatus(id);
  const actions = usePageActions();
  const readWorkflow = useWorkflowReader();
  const models = useModelList();
  const navigate = useNavigate();
  const startChat = useStartChatWith();
  const status = query.data?.run.status;
  // A run that moves shows its seconds; one that has stopped does not need the tick.
  const now = useNow(status === "running" || status === "waiting" ? 1000 : 60_000);
  if (query.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{query.error ? actionErrorText(query.error, "There is no such run.") : "Loading the run."}</p>
      </Frame>
    );
  }
  const { run, steps, reviews } = query.data;
  const sessionId = run.session_id;
  return (
    <Frame>
      <WorkflowRunView
        key={id}
        run={run}
        steps={steps ?? []}
        reviews={reviews ?? []}
        now={now}
        chatPath={(child) => (sessionId === null || sessionId === undefined ? sessionPath(child) : helperPath(child, sessionId))}
        onNavigate={navigate}
        onCancel={() => actions.cancelWorkflow(id)}
        onResume={(model) => actions.resumeWorkflow(id, model)}
        models={modelNames(models.data ?? null)}
        onAnswer={(key, verdict, text) => actions.answerWorkflowReview(id, key, verdict, text)}
        onReadOutput={(index) => actions.readWorkflowOutput(id, index)}
        onAsk={async (question) => {
          // The same ask the workflow page has: one model call over the file, answered, nothing written.
          const workflow = await readWorkflow(run.workflow_id);
          const reply = await actions.proposeWorkflow(run.workflow_id, workflow.code ?? "", question);
          return reply.answer ?? reply.note;
        }}
        onAskAbout={startChat}
        onReveal={(path, index) => actions.reveal(path, { workflowRunId: id, outputIndex: index })}
        onSeeStep={(step) => {
          // The step's place in the workflow's outline, read when asked. When it cannot be found the workflow opens with no step picked.
          readWorkflow(run.workflow_id).then(
            (workflow) => navigate(workflowPath(run.workflow_id, outlineStepOf(workflow.steps ?? [], step)?.id ?? null)),
            () => navigate(workflowPath(run.workflow_id)),
          );
        }}
        trace={sessionId === null || sessionId === undefined ? undefined : <RunTrace sessionId={sessionId} />}
      />
    </Frame>
  );
}
