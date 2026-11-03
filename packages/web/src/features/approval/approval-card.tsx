import { editedArgs, parseArgs, type ToolBlock, type ApprovalChoice } from "@golem/view";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Kbd } from "../../ui/kbd.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { DiffModeSwitch } from "../diff/diff-mode-switch.tsx";
import { useDiffMode } from "../diff/diff-mode.ts";
import { DiffView } from "../diff/diff-view.tsx";
import { approvalTarget, verdictText } from "./text.ts";

const CHIP = "rounded-sm bg-clay-soft px-1.5 py-0.5 font-mono text-sm font-medium text-clay-ink";

/** The clay seal: a shield with a tick. */
function Seal() {
  return (
    <span className="grid size-7.5 flex-none place-items-center rounded-sm bg-clay text-on-clay">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M8 1.8 13.2 4v4.1c0 3-2.2 5.2-5.2 6.1-3-.9-5.2-3.1-5.2-6.1V4z" />
        <path d="m5.6 8 1.7 1.7L10.6 6.4" />
      </svg>
    </span>
  );
}

const ACTIONS: { decision: ApprovalChoice; label: string; key: string; shortcut: string; kind: "ink" | "secondary" | "danger" }[] = [
  { decision: "allow", label: "Allow once", key: "↵", shortcut: "Enter", kind: "ink" },
  { decision: "allow_session", label: "For this session", key: "S", shortcut: "S", kind: "secondary" },
  { decision: "allow_always", label: "Always", key: "W", shortcut: "W", kind: "secondary" },
  { decision: "deny", label: "Deny", key: "D", shortcut: "D", kind: "danger" },
];

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
 * The question about one tool call, drawn like the shem: the seal, what is asked, the rule that
 * asked, the change or the arguments, and the answers. Once answered it shrinks to one line.
 */
export function ApprovalCard({
  tool,
  pending,
  sending = false,
  error = null,
  editing = false,
  draft,
  onEdit = () => {},
  onAnswer,
}: {
  tool: ToolBlock;
  pending: boolean;
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
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const showEditor = editing && pending && tool.approval?.answer === undefined;
  useEffect(() => {
    // Closing the editor puts focus back on the button that opened it.
    if (wasEditing.current && !showEditor) editButton.current?.focus();
    wasEditing.current = showEditor;
  }, [showEditor]);
  const approval = tool.approval;
  if (approval === undefined) return null;
  const answer = approval.answer;
  const open = pending && answer === undefined;
  const target = approvalTarget(tool.args, approval.subject);
  return (
    <section role="group" aria-label="Approval" className={cn("overflow-hidden rounded-lg border border-line-strong bg-surface", open && "shadow-soft")}>
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <Seal />
        <div className="min-w-0">
          <h2 className="text-base leading-snug font-semibold wrap-anywhere">
            Allow <code className={CHIP}>{tool.name}</code>
            {target ? (
              <>
                {" on "}
                <span title={target.full}>{target.short}</span>
              </>
            ) : null}
            ?
          </h2>
          <p className="mt-1 font-mono text-xs leading-snug text-muted wrap-anywhere">
            rule: <b className="font-medium text-ink">{tool.name} → ask</b>
            {approval.source ? ` · ${approval.source}` : ""}
          </p>
        </div>
        {open && !showEditor && tool.diff ? (
          <div className="ml-auto flex-none">
            <DiffModeSwitch mode={mode} onChange={setMode} />
          </div>
        ) : null}
      </div>
      {open && showEditor ? (
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
      ) : open ? (
        <>
          {tool.diff ? (
            <div className="overflow-x-auto border-y border-line bg-bg px-4 py-2 font-mono text-xs">
              <DiffView diff={tool.diff} mode={mode} />
            </div>
          ) : (
            <pre className="max-h-60 overflow-auto border-y border-line bg-code-bg px-4 py-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3.5">
            {ACTIONS.map((action) => (
              <Fragment key={action.decision}>
                {action.decision === "deny" ? (
                  <>
                    <Button
                      disabled={sending}
                      ref={editButton}
                      aria-keyshortcuts="E"
                      data-action="edit"
                      onClick={() => {
                        onEdit(true);
                      }}
                    >
                      Edit
                      <Kbd>E</Kbd>
                    </Button>
                  </>
                ) : null}
                <Button
                  kind={action.kind}
                  className={action.decision === "deny" ? "ml-auto" : undefined}
                  disabled={sending}
                  aria-keyshortcuts={action.shortcut}
                  data-decision={action.decision}
                  onClick={() => {
                    onAnswer(action.decision);
                  }}
                >
                  {action.label}
                  <Kbd className={action.kind === "ink" ? INK_KBD : undefined}>{action.key}</Kbd>
                </Button>
              </Fragment>
            ))}
          </div>
          {error ? (
            <p role="alert" className="px-4 pb-3.5 text-sm text-deny">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <p className={cn("pr-4 pb-3.5 pl-14.5 font-mono text-xs leading-snug", answer === undefined ? "text-muted" : answer.decision === "deny" ? "text-deny" : "text-allow")}>
          {answer === undefined ? (
            "Not answered"
          ) : (
            <>
              <span aria-hidden="true">{answer.decision === "deny" ? "✗ " : "✓ "}</span>
              {verdictText(answer)}
            </>
          )}
        </p>
      )}
    </section>
  );
}
