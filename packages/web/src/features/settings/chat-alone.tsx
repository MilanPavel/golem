import { MODE_ALWAYS_ASKS, MODE_LABEL, PERMISSION_MODES, type PermissionMode } from "@golem/view";
import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useChatDefaults, usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { ChatRow, Switch } from "./chat-controls.tsx";

/** What each mode asks about, for a general tool: reading, the web, files outside the folder, and commands that change things. */
export const MODE_ASKS: Readonly<Record<PermissionMode, string>> = {
  careful: "Reads files alone. Asks before the web, files outside the folder, and anything that changes something.",
  balanced: "Reads and looks things up on the web alone. Asks before files outside the folder and anything that changes something.",
  autopilot: "Also changes files and runs commands inside the folder without asking. Files outside the folder still ask.",
};

/** The default mode as cards. Autopilot asks in place first. `onSave` writes it. */
function ModeCards({ mode, onSave, saved }: { mode: PermissionMode; onSave: (mode: PermissionMode) => void; saved: string | null }) {
  const [confirming, setConfirming] = useState(false);

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

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div role="radiogroup" aria-label="Mode" className="grid gap-2 sm:grid-cols-3">
        {PERMISSION_MODES.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            data-setting={item === "autopilot" ? "autopilot" : undefined}
            aria-checked={item === mode}
            onClick={() => {
              pick(item);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-start gap-1 rounded-md border px-3 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
              item === mode ? "border-clay bg-clay-soft text-clay-ink" : "border-line-strong bg-bg text-muted hover:text-ink",
            )}
          >
            <span className="text-sm font-medium">{MODE_LABEL[item]}</span>
            <span className="text-xs">{MODE_ASKS[item]}</span>
          </button>
        ))}
      </div>
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
      <p className="text-xs text-muted">{MODE_ALWAYS_ASKS} A chat can use another mode: pick it in the composer.</p>
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
};

/** How far it goes alone: the default mode, and Start with a plan. */
export function HowFarView({ mode, planFirst, onMode, onPlan, saved = null, error = null }: HowFarProps) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-head`} className="flex flex-col gap-3">
      <div className="flex max-w-column flex-col gap-1">
        <h3 id={`${id}-head`} className="text-base font-semibold text-ink">
          How far it goes alone
        </h3>
        <p className="text-sm text-muted">What golem may do before it checks with you. The composer changes one chat.</p>
      </div>
      <ul aria-label="How far it goes alone" className="m-0 flex max-w-column list-none flex-col rounded-lg border border-line bg-surface px-4 py-1">
        <ChatRow setting="default mode" label="Mode" labelId={`${id}-mode`} stacked control={<ModeCards mode={mode} onSave={onMode} saved={saved} />}>
          Your tool rules are checked first, in every mode.
        </ChatRow>
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
      </ul>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </section>
  );
}

/** The two defaults from the daemon: `[permissions] mode` through `permissions.set_mode`, and `[chat] plan_first` through `chat.set`. */
export function HowFarItGoesAlone() {
  const chat = useChatDefaults();
  const actions = usePageActions();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
