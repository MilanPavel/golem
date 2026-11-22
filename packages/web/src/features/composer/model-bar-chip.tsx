import { AUTO_MODEL_HINT, routeLabel, sessionModelOf, shownModel, shownModelText, type RouteMode } from "@golem/view";
import { useRef, useState, type ReactNode } from "react";
import { useConfig, useModelList, useNavigate, useSession, useSessionList } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { CpuIcon, SlidersIcon } from "../../ui/icons.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { openModelDialog } from "../models/index.ts";
import { BAR_CHIP } from "./composer-bar.ts";
import { RoutePanel } from "./route-panel.tsx";
import { useTuneChanges } from "./tune-changes.ts";

const ROW =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2";

/** A model's name in mono. Under 400 px of composer it loses its tag: `qwen3.8:27b` reads `qwen3.8`. */
export function ModelName({ name }: { name: string }) {
  const colon = name.indexOf(":");
  return (
    <Code tone="inherit" className="min-w-0 truncate">
      {colon < 0 ? name : name.slice(0, colon)}
      {colon < 0 ? null : <span className="@max-row-400/comp:hidden">{name.slice(colon)}</span>}
    </Code>
  );
}

/**
 * The model of a chat, in the composer's row. After the name it says the route when it is not Pinned
 * (`· auto`, `· local`), and a small clay dot when the options differ from the model's own. Its menu
 * has the route switch first, then `Choose a model…` and, with changed options, `Tune…`.
 * Under 600 px the route word goes, and under 400 px the name loses its tag (`qwen3.8:27b` is `qwen3.8`).
 */
export function ModelBarChipView({
  name,
  route,
  tuned,
  title,
  label,
  open,
  onOpenChange,
  panel,
  onChoose,
  onTune,
}: {
  /** The model's name, as the chip shows it. */
  name: string;
  route: RouteMode;
  /** The changed options, `temp 0.2`, or null when there are none. */
  tuned: string | null;
  title: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The route section: the switch, the ladder, the spend. */
  panel: ReactNode;
  /** Opens the dialog. It gets the chip, so focus can go back to it. The menu closes first. */
  onChoose: (trigger: HTMLElement) => void;
  onTune?: (trigger: HTMLElement) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const handoff = useRef(false);
  const hand = (open: ((trigger: HTMLElement) => void) | undefined): void => {
    handoff.current = true;
    onOpenChange(false);
    if (trigger.current !== null) open?.(trigger.current);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger ref={trigger} title={title} aria-label={label} className={cn(BAR_CHIP, "max-w-60 shrink")}>
        <CpuIcon />
        <ModelName name={name} />
        {route === "pinned" ? null : <span className="shrink-0 text-faint @max-row-600/comp:hidden">· {routeLabel(route)}</span>}
        {tuned === null ? null : <span aria-hidden="true" data-tuned="" className="size-1.5 shrink-0 rounded-full bg-clay" />}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Model and route"
        className="flex w-80 flex-col gap-3 max-sm:w-72"
        onCloseAutoFocus={(event) => {
          // A dialog opened from the menu takes the focus, so the chip does not.
          if (handoff.current) {
            handoff.current = false;
            event.preventDefault();
          }
        }}
      >
        {panel}
        <div className="-mx-2 flex flex-col border-t border-line px-2 pt-2">
          <button type="button" className={ROW} onClick={() => hand(onChoose)}>
            <CpuIcon className="size-4 shrink-0 text-muted" />
            <span className="flex min-w-0 flex-col">
              <span>Choose a model…</span>
              <span className="text-xs text-muted">Applies from the next turn.</span>
            </span>
          </button>
          {tuned === null || onTune === undefined ? null : (
            <button type="button" className={ROW} onClick={() => hand(onTune)}>
              <SlidersIcon className="size-4 shrink-0 text-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>Tune…</span>
                <span className="truncate text-xs text-muted">{tuned}</span>
              </span>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-clay" />
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const selectMode = ({ chat }: SessionView) => chat.route.mode;
const selectLast = ({ chat }: SessionView) => chat.route.last;
const selectCwd = (view: SessionView) => view.cwd;
const selectModel = (view: SessionView) => view.model;

/** The chip of a session. The route change is the dock's, so its failure shows on the dock's error line. */
export function ModelBarChip({ sessionId, onRoute }: { sessionId: string; onRoute: (mode: RouteMode) => void }) {
  const mode = useSession(sessionId, selectMode);
  const last = useSession(sessionId, selectLast);
  const cwd = useSession(sessionId, selectCwd);
  const live = useSession(sessionId, selectModel);
  const summary = useSessionList().find((session) => session.session_id === sessionId);
  const model = live ?? (summary ? { profile: summary.model_profile, provider: null, name: null } : null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const models = useModelList(mode === "auto");
  const config = useConfig(cwd, sessionId, mode === "auto");
  const tune = useTuneChanges(sessionId);
  if (model === null) return null;
  const session = sessionModelOf(model, models.data?.models);
  const shown = shownModel({ mode, session, last, models: models.data?.models, routing: config.data?.routing });
  const text = shownModelText({ name: shown.name, pick: false });
  const profile = [model.profile, model.provider].filter((part) => part !== null).join(" · ");
  const route = mode === "pinned" ? "" : `, route ${routeLabel(mode)}`;
  return (
    <ModelBarChipView
      name={text}
      route={mode}
      tuned={tune?.text ?? null}
      title={[text, shown.pick ? AUTO_MODEL_HINT : profile].filter((part) => part !== "").join(" · ")}
      label={`Model: ${text}${route}${tune === null ? "" : ", options changed"}`}
      open={open}
      onOpenChange={setOpen}
      panel={
        <RoutePanel
          sessionId={sessionId}
          open={open}
          onSelect={onRoute}
          onNavigate={(path) => {
            setOpen(false);
            navigate(path);
          }}
        />
      }
      onChoose={(trigger) => openModelDialog({ sessionId, returnTo: trigger })}
      {...(tune === null ? {} : { onTune: tune.open })}
    />
  );
}
