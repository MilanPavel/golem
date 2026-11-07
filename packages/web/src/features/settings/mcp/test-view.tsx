import { formatTestResult, formatTestStep } from "@golem/view";
import { useEffect, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpServer, McpTestResult } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";

/** A test of the saved server, each step shown as it ends, and then what it found. */
export function TestView({ server, sessionId, onBack }: { server: McpServer; sessionId: string | null; onBack: () => void }) {
  const [round, setRound] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button size="sm" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" onClick={() => setRound((now) => now + 1)}>
          Test again
        </Button>
      </div>
      <h3 className="font-mono text-base font-semibold wrap-anywhere">Test {server.name}</h3>
      <Run key={round} name={server.name} sessionId={sessionId} />
    </div>
  );
}

/** One run. A new `key` starts another, and leaving ends the listening. */
function Run({ name, sessionId }: { name: string; sessionId: string | null }) {
  const actions = usePageActions();
  const [steps, setSteps] = useState<readonly string[]>([]);
  const [outcome, setOutcome] = useState<McpTestResult | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    actions
      .testMcp(name, sessionId, (step) => {
        const line = formatTestStep(step);
        if (live && line !== null) setSteps((now) => [...now, line]);
      })
      .then(
        (result) => {
          if (live) setOutcome(result);
        },
        (error: unknown) => {
          if (live) setOutcome({ error: actionErrorText(error, "The test could not run.") });
        },
      );
    return () => {
      live = false;
    };
  }, [actions, name, sessionId]);
  return (
    <>
      <ol aria-label="Test steps" aria-live="polite" className="flex flex-col gap-1 font-mono text-sm">
        {steps.map((line, index) => (
          <li key={index} className="wrap-anywhere">
            {line}
          </li>
        ))}
      </ol>
      {outcome === null ? (
        <p className="font-mono text-sm text-muted">testing…</p>
      ) : "error" in outcome ? (
        <p role="alert" className="text-sm text-deny">
          {outcome.error}
        </p>
      ) : (
        <div role="status" className="flex flex-col gap-1 font-mono text-sm">
          {formatTestResult(outcome)
            .split("\n")
            .map((line, index) => (
              <p key={index} className={index === 0 ? (outcome.ok ? "text-allow" : "text-deny") : "text-muted wrap-anywhere"}>
                {index === 0 ? `${outcome.ok ? "✔" : "✘"} ` : ""}
                {line}
              </p>
            ))}
        </div>
      )}
    </>
  );
}
