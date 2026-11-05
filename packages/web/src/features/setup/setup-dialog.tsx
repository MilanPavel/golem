import { shortStepper, STEP_MARKS, stepper, type PanelKey, type SetupWindow, type StepState } from "@golem/view";
import type { KeyboardEvent } from "react";
import type { PullEntry } from "../../store/pulls.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { PanelBody } from "./panel-body.tsx";
import type { PanelView } from "./setup-ui.ts";

const STEP_WORDS: Record<StepState, string> = { done: "done", now: "current step", todo: "to do", skip: "skipped" };

/** The stepper of guided mode: a mark and a word for each step, so colour is not the signal. */
function Stepper({ window }: { window: SetupWindow }) {
  const steps = stepper(window);
  if (steps === null) return null;
  return (
    <ol aria-label="Setup steps" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {steps.map((step) => (
        <li
          key={step.name}
          aria-current={step.state === "now" ? "step" : undefined}
          className={cn("flex items-center gap-1.5", step.state === "now" ? "font-medium text-ink" : "text-muted")}
        >
          <span aria-hidden="true" className={cn("font-mono", step.state === "now" && "text-clay-ink")}>
            {STEP_MARKS[step.state]}
          </span>
          {step.name}
          <span className="sr-only"> ({STEP_WORDS[step.state]})</span>
        </li>
      ))}
    </ol>
  );
}

function backLabel(view: PanelView): string {
  if (view.id === "model:downloading") return "Keep downloading";
  if (view.id === "ollama:installing") return "Stop install";
  return "Back";
}

export type SetupDialogViewProps = {
  open: boolean;
  /** The close button, and what a click outside does: the same as Later, the page goes on. */
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  window: SetupWindow;
  view: PanelView;
  /** The running download of the Model panel. */
  pull?: PullEntry | undefined;
  /** A key the window takes, through the panel's reducer. Esc is `back`. */
  onKey: (key: PanelKey) => void;
  /** A click on a choice: select it, then Enter. */
  onChoose: (index: number) => void;
};

/**
 * The setup window as a centred dialog: the stepper in guided mode, then the panel. The view
 * takes everything as props, so the gallery can show every state; `SetupDialog` is the connected one.
 */
export function SetupDialogView({ open, onClose, onCloseAutoFocus, window, view, pull, onKey, onChoose }: SetupDialogViewProps) {
  const guided = shortStepper(window);
  const showBack = window.view === "panel" && window.panel !== "ready";

  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onKey(event.key === "ArrowUp" ? "up" : "down");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-h-screen max-w-lg overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onKey("back");
        }}
        onOpenAutoFocus={(event) => {
          // The choices take focus, not the close button that comes first.
          event.preventDefault();
          const content = event.currentTarget;
          if (content instanceof HTMLElement) content.querySelector<HTMLElement>("[aria-current=true]")?.focus();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle>Setup</DialogTitle>
            <DialogDescription>
              {guided === null ? (window.view === "overview" ? "What is set up, and what is not." : "One step of setup.") : `Step ${guided}`}
            </DialogDescription>
          </div>
          <IconButton label="Close setup" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <Stepper window={window} />
        <div className="mt-4">
          <PanelBody view={view} onChoose={onChoose} pull={pull} focus={open} />
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-xs text-muted">{view.hint}</p>
          {showBack ? (
            <Button size="sm" kind="ghost" onClick={() => onKey("back")}>
              {backLabel(view)}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
