import { useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { NotificationsSetParams, NotificationsSetResult, NotificationsValues, NotifyTestResult } from "../../store/notifications.ts";
import { useNotifications, usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

const GROUP = "mb-1 mt-4 border-b border-line pb-1 text-meta text-faint";
const ROW = "flex flex-col gap-1 border-t border-dashed border-line py-2 first:border-t-0";
const SEG_CLASS = "inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-md border border-line-strong bg-bg p-0.5";
const SEG_BUTTON_CLASS =
  "rounded-sm border border-transparent px-3 py-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2 aria-checked:border-line-strong aria-checked:bg-surface aria-checked:text-ink disabled:pointer-events-none disabled:opacity-50";

export const LATER = "Comes later.";
export const TEST_SENT = "Sent. Look for the banner.";
export const TEST_NOT_SHOWN = "Nothing was shown. golem posts banners only from the real golem home on a Mac.";

/** One Tune-style row: a label and a control on one line, the explanation below. */
function Row({ label, labelId, control, children }: { label: string; labelId: string; control: ReactNode; children: ReactNode }) {
  return (
    <li className={ROW}>
      <div className="flex items-center gap-3">
        <span id={labelId} className="text-sm font-medium text-ink">
          {label}
        </span>
        <span className="ml-auto flex items-center gap-3">{control}</span>
      </div>
      <p className="text-xs text-muted">{children}</p>
    </li>
  );
}

function Switch({ labelledBy, checked, disabled = false, onToggle }: { labelledBy: string; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full outline-offset-2 outline-clay focus-visible:outline-2 disabled:opacity-50",
        checked ? "bg-clay" : "bg-line-strong",
      )}
    >
      <span aria-hidden="true" className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform motion-reduce:transition-none", checked && "translate-x-4")} />
    </button>
  );
}

function Segmented({ label, choices, checked, onPick }: { label: string; choices: readonly string[]; checked: string; onPick: (choice: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={SEG_CLASS}>
      {choices.map((choice) => (
        <button key={choice} type="button" role="radio" aria-checked={choice === checked} onClick={() => onPick(choice)} className={SEG_BUTTON_CLASS}>
          {choice}
        </button>
      ))}
    </div>
  );
}

const OPEN_IN = [
  { value: "web", label: "Web" },
  { value: "terminal", label: "Terminal" },
] as const;

function names(list: readonly string[]): ReactNode {
  return list.map((name, index) => (
    <span key={name}>
      {index === 0 ? "" : index === list.length - 1 ? " and " : ", "}
      <Code>{name}</Code>
    </span>
  ));
}

/** What the page shows of `[notifications]`, and how it saves a change and sends a test. Apart from the hooks, so the gallery can show it. */
export type NotificationsViewProps = {
  values: NotificationsValues;
  /** Saves these keys. The daemon's answer comes back in the result. */
  onChange: (patch: NotificationsSetParams) => void;
  onTest: () => void;
  /** The message of a refused or failed save, or null. */
  error: string | null;
  /** The answer to the last test, or null before one. */
  tested: string | null;
};

export function NotificationsView({ values, onChange, onTest, error, tested }: NotificationsViewProps) {
  return (
    <div className="flex max-w-column flex-col">
      <p className="text-sm text-muted">golem sends macOS notifications while routines and workflows run without you.</p>
      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-deny">
          {error}
        </p>
      )}

      <h3 className={GROUP}>Tell me</h3>
      <ul aria-label="Tell me" data-setting="tell me">
        <Row label="When something needs me" labelId="notify-needs-you" control={<Switch labelledBy="notify-needs-you" checked disabled onToggle={() => {}} />}>
          An approval or a question is waiting. Always on: this one cannot be turned off.
        </Row>
        <Row
          label="When a run fails"
          labelId="notify-failed"
          control={<Switch labelledBy="notify-failed" checked={values.failed} onToggle={() => onChange({ failed: !values.failed })} />}
        >
          A routine or workflow stopped with an error.
          {values.failed || (values.failed_routines ?? []).length === 0 ? null : <> Still on for {names(values.failed_routines ?? [])}.</>}
        </Row>
        <Row
          label="When a run finishes"
          labelId="notify-finished"
          control={<Switch labelledBy="notify-finished" checked={values.finished} onToggle={() => onChange({ finished: !values.finished })} />}
        >
          Off by default. Each routine can override this with <Code>notify_finished</Code>.
          {(values.finished_routines ?? []).length === 0 ? null : <> {names(values.finished_routines ?? [])} tell me when done.</>}
        </Row>
      </ul>

      <h3 className={GROUP}>Clicking a notification</h3>
      <ul aria-label="Clicking a notification" data-setting="clicking a notification">
        <Row
          label="Open clicks in"
          labelId="notify-open-in"
          control={
            <Segmented
              label="Open clicks in"
              choices={OPEN_IN.map((item) => item.label)}
              checked={OPEN_IN.find((item) => item.value === values.open_in)?.label ?? ""}
              onPick={(label) => {
                const next = OPEN_IN.find((item) => item.label === label);
                if (next !== undefined && next.value !== values.open_in) onChange({ open_in: next.value });
              }}
            />
          }
        >
          Web opens the session in your browser. Terminal runs <Code>golem attach</Code> in a terminal tab.
        </Row>
        <Row
          label="Terminal app"
          labelId="notify-terminal-app"
          control={
            <Segmented
              label="Terminal app"
              choices={values.terminal_apps}
              checked={values.terminal_app}
              onPick={(app) => {
                if (app !== values.terminal_app) onChange({ terminal_app: app });
              }}
            />
          }
        >
          The app Terminal clicks use. A click on a banner cannot open it yet; <Code>golem open --notified</Code> does.
        </Row>
      </ul>

      <h3 className={GROUP}>Quiet hours</h3>
      <ul aria-label="Quiet hours" data-setting="quiet hours">
        <Row label="Quiet hours" labelId="notify-quiet" control={<Switch labelledBy="notify-quiet" checked={false} disabled onToggle={() => {}} />}>
          {LATER} Notifications will wait until the end; runs still run.
        </Row>
      </ul>

      <h3 className={GROUP}>Pause</h3>
      <ul aria-label="Pause" data-setting="pause">
        <Row
          label="Pause all routines"
          labelId="notify-pause"
          control={
            <Button size="sm" disabled aria-labelledby="notify-pause">
              Pause
            </Button>
          }
        >
          {LATER} Routines and file triggers will stop starting; runs already going finish.
        </Row>
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button onClick={onTest}>Send a test</Button>
        <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted">
          {tested}
        </p>
      </div>
    </div>
  );
}

/** The result of a test, as a sentence. */
export function testText(result: NotifyTestResult): string {
  return result.posted ? TEST_SENT : `${TEST_NOT_SHOWN} (${result.mechanism})`;
}

/** The first message of a refused save. */
function refusal(result: NotificationsSetResult): string | null {
  return result.ok ? null : (result.errors?.[0]?.message ?? "The settings were not saved.");
}

/** Settings › Notifications: what tells you, where a click lands, and a test. Each change saves on its own. */
export function NotificationsSection() {
  const query = useNotifications();
  const actions = usePageActions();
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);

  async function change(patch: NotificationsSetParams): Promise<void> {
    try {
      setError(refusal(await actions.setNotifications(patch)));
    } catch (failure) {
      setError(actionErrorText(failure, "Could not save the settings."));
    }
  }

  async function test(): Promise<void> {
    setTested(null);
    try {
      setTested(testText(await actions.notifyTest()));
    } catch (failure) {
      setTested(actionErrorText(failure, "Could not send the test."));
    }
  }

  if (query.data === undefined) {
    return query.isError ? (
      <p role="alert" className="text-sm text-deny">
        {actionErrorText(query.error, "Could not read the notification settings.")}
      </p>
    ) : (
      <p className="text-sm text-muted">Loading…</p>
    );
  }
  return <NotificationsView values={query.data} error={error} tested={tested} onChange={(patch) => void change(patch)} onTest={() => void test()} />;
}
