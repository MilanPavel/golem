import { useEffect, useId, useRef } from "react";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import type { AgentControls, Draft } from "./agents-editing.ts";

/** Where a new agent's file will be written, said in the editor's path line. */
const NEW_PATH = "new file in ~/.golem/agents/";

/** The question before dropping unsaved text, in place: two buttons, no modal. */
function LeaveQuestion({ controls }: { controls: AgentControls }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm">
      <span>Discard changes?</span>
      <Button size="sm" kind="danger" onClick={controls.onDiscard}>
        Discard
      </Button>
      <Button size="sm" onClick={controls.onKeepEditing}>
        Keep editing
      </Button>
    </div>
  );
}

/** "Not saved." with each problem on its own line, announced when it appears. */
function Refused({ id, draft }: { id: string; draft: Draft }) {
  const lines = draft.failure === null ? draft.problems : [draft.failure];
  return (
    <div id={id} role="alert" className="flex flex-col gap-1 rounded-md bg-deny-soft px-3 py-2 text-meta text-deny">
      <p className="font-medium">Not saved.</p>
      <ul className="flex flex-col gap-0.5">
        {lines.map((line) => (
          <li key={line} className="wrap-anywhere">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The file of an agent in a text box, with Save and Cancel. The focus goes to the box when it opens, and back to
 * it after "Keep editing". A refused save keeps the text and says why under it.
 */
export function AgentEditor({ path, name, draft, controls }: { path: string | null; name: string; draft: Draft; controls: AgentControls }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const was = useRef(controls.leaving);
  const note = useId();
  const focus = controls.focusText;
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus]);
  useEffect(() => {
    if (was.current && !controls.leaving) box.current?.focus();
    was.current = controls.leaving;
  }, [controls.leaving]);
  const refused = draft.problems.length > 0 || draft.failure !== null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Code tone="muted" className="min-w-0 wrap-anywhere">
          {`${path ?? NEW_PATH} · editing`}
        </Code>
        <span className="flex gap-2">
          <Button size="sm" disabled={controls.busy} onClick={controls.onCancel}>
            Cancel
          </Button>
          <Button size="sm" kind="primary" disabled={controls.busy} onClick={controls.onSave}>
            Save
          </Button>
        </span>
      </div>
      {controls.leaving ? <LeaveQuestion controls={controls} /> : null}
      <textarea
        ref={box}
        value={draft.text}
        onChange={(event) => controls.onText(event.target.value)}
        spellCheck={false}
        aria-label={draft.name === null ? "File of the new agent" : `Edit the file of ${name}`}
        aria-invalid={refused ? true : undefined}
        aria-describedby={note}
        className="min-h-80 w-full resize-y rounded-lg border border-line bg-code-bg p-4 font-mono text-code whitespace-pre text-ink outline-offset-2 outline-clay focus-visible:outline-2"
      />
      {refused ? (
        <Refused id={note} draft={draft} />
      ) : (
        <p id={note} className="text-meta text-muted">
          The top part between the two --- lines holds the settings; the rest is the prompt.
        </p>
      )}
    </div>
  );
}

/** The detail of an agent that is not saved yet: a head and the editor on the Definition tab. */
export function NewAgentDetail({ draft, controls }: { draft: Draft; controls: AgentControls }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 className="font-ui text-lg font-semibold">New agent</h3>
        <p className="max-w-prose text-sm text-muted">Fill in the file and save. The lead sees the name and the description.</p>
      </header>
      <Tabs value="definition" className="flex flex-col gap-3">
        <TabsList aria-label="New agent details">
          <TabsTrigger value="definition">Definition</TabsTrigger>
        </TabsList>
        <TabsContent value="definition">
          <AgentEditor path={null} name="new agent" draft={draft} controls={controls} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
