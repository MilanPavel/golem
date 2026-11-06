import { OVERVIEW, setupProblem } from "@golem/view";
import { useEffect } from "react";
import { useSetupStatus } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { openSetup } from "../setup/index.ts";

/** What is set up, in one line, and the way into the overview window. */
export function SetupSection() {
  const status = useSetupStatus();
  const { refetch } = status;
  // A key set in a terminal pushes no event, so look again when the section opens.
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const rows = status.isError ? null : (status.data?.rows ?? null);
  const line = rows === null ? null : (setupProblem(rows) ?? "all set");
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      {line === null ? null : (
        <p role="status" className="font-mono text-sm text-muted">
          {line}
        </p>
      )}
      <div>
        <Button onClick={(event) => openSetup({ window: OVERVIEW, returnTo: event.currentTarget })}>Open setup</Button>
      </div>
    </div>
  );
}
