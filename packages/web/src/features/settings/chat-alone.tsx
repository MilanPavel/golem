import { MODE_LABEL, PERMISSION_MODES, type PermissionMode } from "@golem/view";
import { Fragment, useId, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useChatDefaults, useNavigate, usePageActions } from "../../store/page-context.tsx";
import { settingsPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { ChatRow, Switch } from "./chat-controls.tsx";

/** What each mode asks about, for a general tool: reading, the web, files outside the folder, and commands that change things. */
export const MODE_ASKS: Readonly<Record<PermissionMode, string>> = {
  careful: "Reads files alone. Asks before the web, files outside the folder, and anything that changes something.",
  balanced: "Reads and looks things up on the web alone. Asks before files outside the folder and anything that changes something.",
  autopilot: "Also changes files and runs commands inside the folder without asking. Files outside the folder still ask.",
};

/** How many zones of the track are left of each stop: the ones golem does alone. */
const ALONE_ZONES: Readonly<Record<PermissionMode, number>> = { careful: 1, balanced: 2, autopilot: 3 };

/** The four zones of the track: what golem does, and the words under it. */
const ZONES: readonly { name: string; note: string }[] = [
  { name: "Read files", note: "in the folder" },
  { name: "Look things up", note: "on the web" },
  { name: "Change files, run commands", note: "inside the folder" },
  { name: "Outside the folder", note: "also the unsandboxed shell and MCP tools" },
];

type ZoneState = "alone" | "asks" | "lock";

const ZONE_LABEL: Readonly<Record<ZoneState, string>> = { alone: "alone", asks: "asks you", lock: "always asks" };
const ZONE_STYLE: Readonly<Record<ZoneState, string>> = {
  alone: "bg-allow-soft [&>em]:text-allow",
  asks: "bg-wait-soft [&>em]:text-wait",
  lock: "bg-track-lock [&>em]:text-wait",
};
const ZONE_BASE = "flex min-h-21 flex-col gap-0.5 rounded-md px-3 py-2.5 text-note";

function Zone({ state, name, note }: { state: ZoneState; name: string; note: string }) {
  return (
    <div data-zone={state} className={cn(ZONE_BASE, ZONE_STYLE[state])}>
      <em className="mb-1 text-micro font-semibold tracking-wide uppercase not-italic">{ZONE_LABEL[state]}</em>
      <b className="text-body leading-tight font-semibold text-ink">{name}</b>
      <span className="text-muted">{note}</span>
    </div>
  );
}

/** The default mode as a track: zones golem does alone, then zones it asks about, and the stops between them are the choice. Autopilot asks in place first. `onSave` writes it. */
function ModeTrack({ mode, planFirst, onSave, saved }: { mode: PermissionMode; planFirst: boolean; onSave: (mode: PermissionMode) => void; saved: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const group = useRef<HTMLDivElement>(null);

  function pick(next: PermissionMode): void {
    if (next === mode) {
      setConfirming(false);
      return;
    }
    if (next === "autopilot") {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onSave(next);
  }

  function move(event: React.KeyboardEvent, index: number): void {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = (index + step + PERMISSION_MODES.length) % PERMISSION_MODES.length;
    const next = PERMISSION_MODES[at];
    if (next === undefined) return;
    pick(next);
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[at]?.focus();
  }

  const alone = ALONE_ZONES[mode];
  return (
    <div className="flex flex-col gap-2 py-3">
      <div ref={group} role="radiogroup" aria-label="Mode" className={cn("mt-9 grid grid-cols-1 sm:mt-9", planFirst ? "sm:cols-track-plan" : "sm:cols-track")}>
        {planFirst ? (
          <div data-zone="plan" className={cn(ZONE_BASE, "mb-2 bg-clay-soft sm:mr-2 sm:mb-0 [&>em]:text-clay-ink")}>
            <em className="mb-1 text-micro font-semibold tracking-wide uppercase not-italic">first</em>
            <b className="text-body leading-tight font-semibold text-ink">Shows a plan</b>
            <span className="text-muted">waits for your yes</span>
          </div>
        ) : null}
        {ZONES.map((zone, index) => {
          const item = PERMISSION_MODES[index];
          const on = item === mode;
          return (
            <Fragment key={zone.name}>
              <Zone state={index === ZONES.length - 1 ? "lock" : index < alone ? "alone" : "asks"} name={zone.name} note={zone.note} />
              {item === undefined ? null : (
                <button
                  type="button"
                  role="radio"
                  data-setting={item === "autopilot" ? "autopilot" : undefined}
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => {
                    pick(item);
                  }}
                  onKeyDown={(event) => {
                    move(event, index);
                  }}
                  className="group relative flex h-9 cursor-pointer items-center border-0 bg-transparent p-0 outline-none sm:h-auto sm:w-4.5 sm:justify-center"
                >
                  <span aria-hidden="true" className={cn("absolute -top-2 -bottom-2 left-1/2 hidden -translate-x-1/2 rounded-xs sm:block", on ? "w-1 bg-clay" : "w-0.5 bg-track-dash")} />
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-note whitespace-nowrap outline-offset-2 outline-clay group-focus-visible:outline-2 sm:absolute sm:-top-8 sm:left-1/2 sm:-translate-x-1/2",
                      on ? "border-clay bg-clay font-semibold text-on-clay" : "border-line-strong bg-surface text-muted group-hover:border-faint group-hover:text-ink",
                    )}
                  >
                    {MODE_LABEL[item]}
                  </span>
                </button>
              )}
            </Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-body text-ink-soft">
        <b className="font-semibold text-ink">{MODE_LABEL[mode]}.</b> {MODE_ASKS[mode]}
      </p>
      {confirming ? (
        <div role="group" aria-label="Use Autopilot?" className="flex flex-col items-start gap-2 rounded-md border border-line-strong bg-bg px-3 py-2">
          <p className="text-sm text-ink">Autopilot runs commands and changes files without asking. Use it for chats you watch.</p>
          <div className="flex gap-2">
            <Button
              kind="primary"
              size="sm"
              onClick={() => {
                setConfirming(false);
                onSave("autopilot");
              }}
            >
              Use Autopilot
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted wrap-anywhere">
        {saved === null ? null : `Saved to ${saved}`}
      </p>
    </div>
  );
}

export type HowFarProps = {
  mode: PermissionMode;
  planFirst: boolean;
  onMode: (mode: PermissionMode) => void;
  onPlan: (on: boolean) => void;
  /** Where the mode was saved, shown after a save. */
  saved?: string | null;
  error?: string | null;
  /** Where a click on "tool rules" goes. */
  onNavigate?: (href: string) => void;
};

/** How far it goes alone: the default mode, and Start with a plan. */
export function HowFarView({ mode, planFirst, onMode, onPlan, saved = null, error = null, onNavigate = () => undefined }: HowFarProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="How far it goes alone" className="m-0 flex max-w-chat-page list-none flex-col rounded-lg border border-line bg-surface px-4 py-1">
        <li data-setting="default mode" className="flex flex-col">
          <ModeTrack mode={mode} planFirst={planFirst} onSave={onMode} saved={saved} />
        </li>
        <ChatRow
          setting="start with a plan"
          label="Start with a plan"
          labelId={`${id}-plan`}
          control={
            <Switch
              labelledBy={`${id}-plan`}
              checked={planFirst}
              onToggle={() => {
                onPlan(!planFirst);
              }}
            />
          }
        >
          golem shows a short plan first. Nothing that changes anything happens until you say yes.
        </ChatRow>
        <li className="border-t border-dashed border-line py-3 text-xs text-muted">
          Your{" "}
          <Link href={settingsPath("rules")} onNavigate={onNavigate} className="text-clay-ink underline underline-offset-2">
            tool rules
          </Link>{" "}
          are checked first, in every mode. A chat can use another mode: pick it in the composer.
        </li>
      </ul>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

/** The two defaults from the daemon: `[permissions] mode` through `permissions.set_mode`, and `[chat] plan_first` through `chat.set`. */
export function HowFarItGoesAlone() {
  const chat = useChatDefaults();
  const actions = usePageActions();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const values = chat.data;

  async function run(save: () => Promise<void>, fallback: string): Promise<void> {
    setError(null);
    setSaved(null);
    try {
      await save();
    } catch (failure) {
      setError(actionErrorText(failure, fallback));
    }
  }

  if (chat.isError) {
    return (
      <div role="group" aria-label="How far it goes alone" className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(chat.error, "Could not read the chat defaults.")}
        </p>
        <Button size="sm" onClick={() => void chat.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (values === undefined) return <p className="text-body text-muted">loading…</p>;
  return (
    <HowFarView
      mode={values.mode}
      planFirst={values.plan_first}
      saved={saved}
      error={error}
      onNavigate={navigate}
      onMode={(next) =>
        void run(async () => {
          setSaved(await actions.setDefaultMode(next));
        }, "Could not save the default mode.")
      }
      onPlan={(on) =>
        void run(async () => {
          const result = await actions.setChat({ plan_first: on });
          if (!result.ok) setError(result.errors?.[0]?.message ?? "Could not save Start with a plan.");
        }, "Could not save Start with a plan.")
      }
    />
  );
}
