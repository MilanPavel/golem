import { approvalQuestion, displayToolName, editedArgs, parseArgs, type ToolBlock, type ApprovalChoice } from "@golem/view";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { DiffModeSwitch } from "../diff/diff-mode-switch.tsx";
import { useDiffMode } from "../diff/diff-mode.ts";
import { DiffView } from "../diff/diff-view.tsx";
import { approvalTarget } from "./text.ts";

const CHIP = "rounded-sm bg-clay-soft px-1.5 py-0.5 font-mono text-xs font-medium text-clay-ink";

/** The clay seal: a shield with a tick. */
function Seal() {
  return (
    <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-sm bg-clay text-on-clay">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M8 1.8 13.2 4v4.1c0 3-2.2 5.2-5.2 6.1-3-.9-5.2-3.1-5.2-6.1V4z" />
        <path d="m5.6 8 1.7 1.7L10.6 6.4" />
      </svg>
    </span>
  );
}

const INK_KBD = "border-bg/40 bg-transparent text-bg";
const MIN_ROWS = 8;
const MAX_ROWS = 20;

type Args = Readonly<Record<string, unknown>>;

/**
 * The call's arguments as JSON, to change before allowing it once. The draft lives here, so
 * closing the editor drops it. Allow waits for a JSON object; Cmd or Ctrl and Enter allows,
 * Escape closes.
 */
function ArgsEditor({
  tool,
  sending,
  draft,
  onAnswer,
  onCancel,
}: {
  tool: ToolBlock;
  sending: boolean;
  draft?: string;
  onAnswer: (decision: ApprovalChoice, args?: Args) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => draft ?? JSON.stringify(tool.args, null, 2));
  const field = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();
  const reasonId = useId();
  useEffect(() => {
    const el = field.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const parsed = parseArgs(text);
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, text.split("\n").length));

  function allow(): void {
    if (!parsed.ok || sending) return;
    const edited = editedArgs(tool.args, parsed.args);
    if (edited === null) onAnswer("allow");
    else onAnswer("allow", edited);
  }

  return (
    <>
      <div className="border-y border-line bg-code-bg px-4 py-2">
        <label id={labelId} htmlFor={`${labelId}-field`} className="mb-1 block text-xs text-muted">
          Arguments, as JSON. Allow runs the edited call once.
        </label>
        <Textarea
          id={`${labelId}-field`}
          ref={field}
          value={text}
          rows={rows}
          readOnly={sending}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={parsed.ok ? undefined : true}
          aria-describedby={parsed.ok ? undefined : reasonId}
          className="bg-code-bg font-mono text-xs"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!sending) onCancel();
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              allow();
            }
          }}
        />
        {parsed.ok ? null : (
          <p id={reasonId} role="status" className="mt-1 font-mono text-xs text-deny wrap-anywhere">
            {parsed.error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3.5">
        <Button kind="ink" disabled={sending || !parsed.ok} aria-keyshortcuts="Meta+Enter Control+Enter" data-decision="allow" onClick={allow}>
          Allow once
          <Kbd className={INK_KBD}>⌘↵</Kbd>
        </Button>
        <Button disabled={sending} aria-keyshortcuts="Escape" data-action="cancel" onClick={onCancel}>
          Cancel
          <Kbd>Esc</Kbd>
        </Button>
        <Button kind="danger" className="ml-auto" disabled={sending} aria-keyshortcuts="D" data-decision="deny" onClick={() => { onAnswer("deny"); }}>
          Deny
          <Kbd>D</Kbd>
        </Button>
      </div>
    </>
  );
}

/**
 * The question about the one tool call that waits, docked above the composer: the seal, what is
 * asked, why, and the answers. The arguments or the diff sit under Details, open from the start
 * for a change to a file, since that is what you are approving.
 */
export function ApprovalBar({
  tool,
  sending = false,
  error = null,
  editing = false,
  draft,
  onEdit = () => {},
  onAnswer,
}: {
  tool: ToolBlock;
  sending?: boolean;
  error?: string | null;
  /** The arguments are open for editing. */
  editing?: boolean;
  /** The text the editor opens with, in place of the call's arguments: for the gallery. */
  draft?: string;
  onEdit?: (open: boolean) => void;
  onAnswer: (decision: ApprovalChoice, args?: Args) => void;
}) {
  const [mode, setMode] = useDiffMode();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const detailsId = useId();
  const detailsButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const showEditor = editing && tool.approval?.answer === undefined;
  useEffect(() => {
    // Closing the editor puts focus back on the button that opens the details.
    if (wasEditing.current && !showEditor) detailsButton.current?.focus();
    wasEditing.current = showEditor;
  }, [showEditor]);
  const approval = tool.approval;
  if (approval === undefined) return null;
  const details = chosen ?? Boolean(tool.diff);
  const name = displayToolName(tool.name);
  const target = approvalTarget(tool.args, approval.subject);
  const question = approvalQuestion(tool.name, tool.args);
  return (
    <section role="group" aria-label="Approval" data-approval-bar="" className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-soft">
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <Seal />
        <div className="min-w-0">
          <p className="text-sm leading-snug font-semibold wrap-anywhere">
            {question ?? (
              <>
                Allow <code className={CHIP}>{name}</code>
                {target ? (
                  <>
                    {" on "}
                    <span title={target.full}>{target.short}</span>
                  </>
                ) : null}
                ?
              </>
            )}
          </p>
          <p className="mt-0.5 font-mono text-xs leading-snug text-faint wrap-anywhere">asks: {approval.source ? approval.source : "your rules"}</p>
        </div>
      </div>
      {showEditor ? (
        <>
          <ArgsEditor
            tool={tool}
            sending={sending}
            draft={draft}
            onAnswer={onAnswer}
            onCancel={() => {
              onEdit(false);
            }}
          />
          {error ? (
            <p role="alert" className="px-4 pb-3.5 text-sm text-deny">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
            <Button kind="ink" disabled={sending} aria-keyshortcuts="Enter" data-decision="allow" onClick={() => { onAnswer("allow"); }}>
              Allow once
              <Kbd className={INK_KBD}>↵</Kbd>
            </Button>
            <div className="inline-flex">
              <Button className="rounded-r-none" disabled={sending} aria-keyshortcuts="S" data-decision="allow_session" onClick={() => { onAnswer("allow_session"); }}>
                Allow in this chat
                <Kbd>S</Kbd>
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <Button className="-ml-px rounded-l-none px-2" disabled={sending} aria-label="More ways to allow">
                    <span aria-hidden="true">▾</span>
                  </Button>
                </MenuTrigger>
                <MenuContent align="start" side="top">
                  <MenuItem data-decision="allow_always" aria-keyshortcuts="W" onSelect={() => { onAnswer("allow_always"); }}>
                    Always allow {name}
                    <Kbd className="ml-auto">W</Kbd>
                  </MenuItem>
                  {/* Wider scopes ("every read from this server", "all of this server") go here once the daemon can grant them: ticket 686. */}
                </MenuContent>
              </Menu>
            </div>
            <Button ref={detailsButton} kind="ghost" aria-expanded={details} aria-controls={detailsId} onClick={() => { setChosen(!details); }}>
              Details
            </Button>
            <Button kind="danger" className="ml-auto" disabled={sending} aria-keyshortcuts="D" data-decision="deny" onClick={() => { onAnswer("deny"); }}>
              Deny
              <Kbd>D</Kbd>
            </Button>
          </div>
          {details ? (
            <div id={detailsId} className="border-t border-line">
              {tool.diff ? (
                <>
                  <div className="flex justify-end px-3 pt-2">
                    <DiffModeSwitch mode={mode} onChange={setMode} />
                  </div>
                  <div className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs">
                    <DiffView diff={tool.diff} mode={mode} />
                  </div>
                </>
              ) : (
                <pre className="max-h-60 overflow-auto bg-code-bg px-3 py-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              )}
              <div className="px-3 pt-1 pb-3">
                <Button size="sm" disabled={sending} aria-keyshortcuts="E" data-action="edit" onClick={() => { onEdit(true); }}>
                  Edit args
                  <Kbd>E</Kbd>
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="px-3 pb-3 text-sm text-deny">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
