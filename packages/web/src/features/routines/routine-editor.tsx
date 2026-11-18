import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { nextTimesText, scheduleToWhen, WEEK_DAYS, WHEN_KINDS, whenToSchedule, watchPreviewText, watchToOn, type RoutineWhen, type WhenKind } from "@golem/view";
import { actionErrorText } from "../../store/errors.ts";
import type { RoutineConfig } from "../../store/routines.ts";
import type { ListedSkill } from "../../store/skills.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import type { FolderBrowserSlot } from "../settings/routing-exceptions.tsx";

const GROUP = "mb-1 mt-4 border-b border-line pb-1 font-mono text-xs uppercase tracking-wider text-faint first:mt-0";
const ROW = "flex flex-col gap-1 border-t border-dashed border-line py-2 first:border-t-0";
const SEG_CLASS = "inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-md border border-line-strong bg-bg p-0.5";
const SEG_BUTTON_CLASS =
  "rounded-sm border border-transparent px-3 py-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2 aria-checked:border-line-strong aria-checked:bg-surface aria-checked:text-ink disabled:pointer-events-none disabled:opacity-50";

/** What a watch routine's prompt can hold: each is filled in with the file that arrived. */
const PLACEHOLDERS = [
  { token: "{path}", meaning: "The full path of the new file" },
  { token: "{name}", meaning: "The file name" },
  { token: "{dir}", meaning: "The folder it is in" },
] as const;

/** How long the schedule is left alone before the daemon is asked for its next times. */
export const PREVIEW_DELAY_MS = 250;

/** The keys of a routine the editor writes, as the daemon names them in an error. */
const FIELDS = ["name", "schedule", "on", "prompt", "folder", "model", "mcp", "missed"] as const;
type Field = (typeof FIELDS)[number];

/** The field a daemon refusal is about: `schedule: …` names it, and a taken name is the name's. Null when it is about the routine. */
export function errorField(message: string): Field | null {
  const named = /^([a-z_]+)(?:\.|:)/.exec(message)?.[1];
  const found = FIELDS.find((field) => field === named);
  if (found !== undefined) return found;
  if (message.includes("already has a routine called")) return "name";
  if (message.includes("exactly one of schedule")) return "schedule";
  return null;
}

/** The prompt with `/name` at its start: it takes the place of a `/skill` already there, or goes in front of the text. */
export function withSkill(prompt: string, name: string): string {
  const first = /^\/\S*/.exec(prompt);
  if (first !== null) return `/${name}${prompt.slice(first[0].length)}`;
  return prompt === "" ? `/${name} ` : `/${name} ${prompt}`;
}

/** The skill a prompt starts with, as `/name`, or null. */
function skillOf(prompt: string, skills: readonly ListedSkill[]): ListedSkill | null {
  const name = /^\/(\S+)/.exec(prompt)?.[1];
  return name === undefined ? null : (skills.find((skill) => skill.name === name) ?? null);
}

function Row({ label, labelId, control, hint, error, children }: { label: string; labelId: string; control?: ReactNode; hint?: ReactNode; error?: string | null; children?: ReactNode }) {
  return (
    <li className={ROW}>
      <div className="flex items-center gap-3">
        <span id={labelId} className="text-sm font-medium text-ink">
          {label}
        </span>
        {control === undefined ? null : <span className="ml-auto flex items-center gap-3">{control}</span>}
      </div>
      {children}
      {error === undefined || error === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {error}
        </p>
      )}
      {hint === undefined ? null : <p className="text-xs text-muted">{hint}</p>}
    </li>
  );
}

function Segmented<T extends string | number>({ label, choices, checked, onPick }: { label: string; choices: readonly { value: T; label: string }[]; checked: T; onPick: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={SEG_CLASS}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={choice.value === checked} onClick={() => onPick(choice.value)} className={SEG_BUTTON_CLASS}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** What the editor starts with: a routine's own config, a starter's, or nothing. */
export type RoutineDraft = Partial<Pick<RoutineConfig, "name" | "schedule" | "prompt" | "folder" | "model" | "mcp" | "missed">> & { on?: RoutineConfig["on"] };

export type RoutineEditorProps = {
  /** True when this makes a routine, false when it changes the one named in `draft`. */
  create: boolean;
  draft: RoutineDraft;
  now: number;
  /** The skills a prompt can start with. */
  skills: readonly ListedSkill[];
  /** The MCP servers a routine can turn on. */
  servers: readonly string[];
  /** Shows the folder browser, with the folder picked or the cancel. */
  folderBrowser: FolderBrowserSlot;
  /** The model button, with the model it holds and what a pick does. */
  modelPick: (props: { value: string | null; onPick: (ref: string | null) => void }) => ReactNode;
  /** The next three times of a schedule, from the daemon. Rejects with its reason. */
  onPreview: (schedule: string) => Promise<readonly string[]>;
  /** Writes the routine. Rejects with the daemon's reason. */
  onSave: (name: string, fields: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
};

/**
 * The form of a routine, in Tune-style groups: when (a segmented control, the time fields of the kind chosen, the daemon's
 * next three times), what (the prompt, with a skill picker), where and with what, and what happens to a missed run.
 * Save sends every key: for a routine that exists, one left empty is removed from its table.
 */
export function RoutineEditor({ create, draft, now, skills, servers, folderBrowser, modelPick, onPreview, onSave, onCancel }: RoutineEditorProps) {
  const ids = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const wasWatched = draft.on !== undefined && draft.on !== null;
  const [name, setName] = useState(draft.name ?? "");
  const [when, setWhen] = useState<RoutineWhen>(() => (wasWatched ? { ...scheduleToWhen(null), kind: "watch" } : scheduleToWhen(draft.schedule)));
  const [watchFolder, setWatchFolder] = useState(draft.on?.watch ?? "");
  const [glob, setGlob] = useState(draft.on?.glob ?? "");
  const [watchBrowsing, setWatchBrowsing] = useState(false);
  // The schedule as written stays as written until a When control is used, so `weekdays 08:30` is not rewritten as cron.
  const [touched, setTouched] = useState(create);
  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [folder, setFolder] = useState<string | null>(draft.folder ?? null);
  const [browsing, setBrowsing] = useState(false);
  const [model, setModel] = useState<string | null>(draft.model ?? null);
  const [mcp, setMcp] = useState<string[]>(draft.mcp ?? []);
  const [missed, setMissed] = useState<"skip" | "run_once">(draft.missed ?? "skip");
  // The daemon's answer for one schedule. It is the answer to the current schedule only while the two match.
  const [answer, setAnswer] = useState<{ schedule: string; times: readonly string[] } | { schedule: string; error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field | "form", string>>>({});

  const watched = when.kind === "watch";
  const schedule = watched ? null : touched ? whenToSchedule(when) : (draft.schedule ?? null);

  useEffect(() => {
    if (schedule === null) return;
    let current = true;
    const timer = setTimeout(() => {
      onPreview(schedule).then(
        (times) => {
          if (current) setAnswer({ schedule, times });
        },
        (err: unknown) => {
          if (current) setAnswer({ schedule, error: actionErrorText(err, "The daemon could not read this schedule.") });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [schedule, onPreview]);

  const previewed = schedule !== null && answer?.schedule === schedule ? answer : null;
  const previewError = previewed !== null && "error" in previewed ? previewed.error : null;
  const previewText = schedule === null ? "" : previewed === null ? "Asking for the next times…" : "times" in previewed ? nextTimesText(previewed.times, now) : "";

  function change(next: Partial<RoutineWhen>): void {
    setTouched(true);
    setWhen({ ...when, ...next });
  }

  function insertChip(chip: string): void {
    const box = promptRef.current;
    const start = box?.selectionStart ?? prompt.length;
    const end = box?.selectionEnd ?? prompt.length;
    setPrompt(prompt.slice(0, start) + chip + prompt.slice(end));
    if (box === null) return;
    const caret = start + chip.length;
    // The prompt is set on the next render; the caret goes after the chip once it is there.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(caret, caret);
    });
  }

  function pickSkill(skill: string): void {
    setPrompt(withSkill(prompt, skill));
    promptRef.current?.focus();
  }

  function save(): void {
    const found: Partial<Record<Field | "form", string>> = {};
    const on = watched ? watchToOn(watchFolder, glob) : null;
    if (watched && on === null) found.on = "Pick the folder to watch.";
    if (!watched && schedule === null) found.schedule = when.kind === "cron" ? "Write a cron line." : "Fill in the schedule.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    // A routine that exists loses a key with null; a new one just leaves it out.
    const unset = create ? undefined : null;
    const fields: Record<string, unknown> = {
      prompt: prompt.trimEnd(),
      folder: folder ?? unset,
      model: model ?? unset,
      mcp: mcp.length > 0 ? mcp : unset,
      missed,
    };
    if (schedule !== null) fields["schedule"] = schedule;
    // One trigger at a time: a routine that changes from one to the other loses the key of the one it leaves.
    if (on !== null) fields["on"] = on;
    if (watched && draft.schedule) fields["schedule"] = null;
    if (!watched && wasWatched) fields["on"] = null;
    for (const key of Object.keys(fields)) {
      if (fields[key] === undefined) delete fields[key];
    }
    setBusy(true);
    setErrors({});
    onSave(name.trim(), fields).then(
      () => setBusy(false),
      (err: unknown) => {
        setBusy(false);
        const message = actionErrorText(err, "Could not save the routine.");
        setErrors({ [errorField(message) ?? "form"]: message });
      },
    );
  }

  const hint = skillOf(prompt, skills);
  const listed = skills.filter((skill) => skill.usable && skill.user_invocable !== false);
  const known = [...new Set([...servers, ...mcp])];
  const timeInput = (
    <Input
      type="time"
      aria-label="At"
      value={when.time}
      onChange={(event) => change({ time: event.target.value })}
      aria-invalid={schedule === null && touched ? true : undefined}
      className="w-32 font-mono"
    />
  );

  return (
    <form
      aria-label={create ? "New routine" : `Edit ${draft.name ?? "routine"}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) save();
      }}
      className="flex flex-col"
    >
      <section aria-labelledby={`${ids}-when`}>
        <h3 id={`${ids}-when`} className={GROUP}>
          When
        </h3>
        <ul className="flex flex-col">
          <Row label="Repeat" labelId={`${ids}-repeat`}>
            <Segmented<WhenKind> label="Repeat" choices={WHEN_KINDS.map((each) => ({ value: each.kind, label: each.label }))} checked={when.kind} onPick={(kind) => change({ kind })} />
          </Row>
          {watched ? (
            <>
              <Row label="Watch folder" labelId={`${ids}-watch`} error={errors.on} hint="A file that lands here starts one run. Files already there are left alone.">
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    aria-label="Watch folder"
                    placeholder="~/Downloads"
                    autoComplete="off"
                    spellCheck={false}
                    value={watchFolder}
                    aria-invalid={errors.on === undefined ? undefined : true}
                    onChange={(event) => setWatchFolder(event.target.value)}
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button size="sm" onClick={() => setWatchBrowsing(true)}>
                    Browse…
                  </Button>
                </div>
                {watchBrowsing ? (
                  <div className="rounded-lg border border-line">
                    {folderBrowser({
                      onPick: (path) => {
                        setWatchFolder(path);
                        setWatchBrowsing(false);
                      },
                      onCancel: () => setWatchBrowsing(false),
                    })}
                  </div>
                ) : null}
              </Row>
              <Row label="Pattern" labelId={`${ids}-glob`} hint="Matched on the file name, ignoring case. Left empty, every new file counts.">
                <Input
                  type="text"
                  aria-label="Pattern"
                  placeholder="*.pdf"
                  autoComplete="off"
                  spellCheck={false}
                  value={glob}
                  onChange={(event) => setGlob(event.target.value)}
                  className="font-mono"
                />
              </Row>
              <li className={cn(ROW, "min-h-9")}>
                <p aria-live="polite" className="font-mono text-xs text-muted">
                  {watchPreviewText(watchFolder, glob.trim() === "" ? undefined : glob, prompt)}
                </p>
              </li>
            </>
          ) : (
            <>
              {when.kind === "weekly" ? (
                <Row label="On" labelId={`${ids}-day`}>
                  <Segmented<number> label="On" choices={WEEK_DAYS.map((each) => ({ value: each.day, label: each.label }))} checked={when.day} onPick={(day) => change({ day })} />
                </Row>
              ) : null}
              {when.kind === "daily" || when.kind === "weekdays" || when.kind === "weekly" ? (
                <Row label="At" labelId={`${ids}-at`} control={timeInput} error={errors.schedule} />
              ) : null}
              {when.kind === "hours" ? (
                <Row label="Every" labelId={`${ids}-hours`} error={errors.schedule} hint="Hours, from the top of the hour. One that does not divide the day evenly is refused.">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      aria-label="Every N hours"
                      value={when.hours}
                      onChange={(event) => change({ hours: event.target.value })}
                      className="w-24 font-mono"
                    />
                    <span className="text-sm text-muted">hours</span>
                  </div>
                </Row>
              ) : null}
              {when.kind === "cron" ? (
                <Row label="Cron" labelId={`${ids}-cron`} error={errors.schedule} hint="Minute, hour, day of month, month, day of week.">
                  <Input
                    type="text"
                    aria-label="Cron"
                    placeholder="30 8 * * 1-5"
                    autoComplete="off"
                    spellCheck={false}
                    value={when.cron}
                    onChange={(event) => change({ cron: event.target.value })}
                    className="font-mono"
                  />
                </Row>
              ) : null}
              <li className={cn(ROW, "min-h-9")}>
                <p aria-live="polite" className={cn("font-mono text-xs", previewError === null ? "text-muted" : "text-deny")} role={previewError === null ? undefined : "alert"}>
                  {previewError ?? previewText}
                </p>
              </li>
            </>
          )}
          {watched ? null : (
          <Row label="When missed" labelId={`${ids}-missed`} hint={missed === "run_once" ? "A run that came due while the Mac was asleep starts once, late." : "A run that came due while the Mac was asleep is dropped."} error={errors.missed}>
            <Segmented<"skip" | "run_once"> label="When missed" choices={[{ value: "skip", label: "Skip" }, { value: "run_once", label: "Run once" }]} checked={missed} onPick={setMissed} />
          </Row>
          )}
        </ul>
      </section>

      <section aria-labelledby={`${ids}-what`}>
        <h3 id={`${ids}-what`} className={GROUP}>
          What
        </h3>
        <ul className="flex flex-col">
          {create ? (
            <Row label="Name" labelId={`${ids}-name`} error={errors.name} hint="Lowercase letters, digits and dashes. It is the routine's name in config.toml.">
              <Input
                type="text"
                aria-label="Name"
                autoComplete="off"
                spellCheck={false}
                value={name}
                aria-invalid={errors.name === undefined ? undefined : true}
                onChange={(event) => setName(event.target.value)}
                className="font-mono"
              />
            </Row>
          ) : null}
          <Row
            label="Prompt"
            labelId={`${ids}-prompt`}
            error={errors.prompt}
            control={
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" aria-label="Insert a skill" disabled={listed.length === 0}>
                    / Skill
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="flex max-h-80 w-md max-w-full flex-col gap-1 overflow-y-auto p-2">
                  <ul aria-label="Skills" className="flex flex-col gap-px">
                    {listed.map((skill) => (
                      <li key={`${skill.source}/${skill.name}`}>
                        <PopoverClose asChild>
                          <button
                            type="button"
                            onClick={() => pickSkill(skill.name)}
                            className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2"
                          >
                            <span className="font-mono text-sm">/{skill.name}</span>
                            <span className="line-clamp-2 text-xs text-muted">{skill.description}</span>
                          </button>
                        </PopoverClose>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            }
            hint={hint?.argument_hint ? `/${hint.name} ${hint.argument_hint}` : "Text, or a /skill with its arguments. It is the first message of the session."}
          >
            {watched ? (
              <div role="group" aria-label="Insert a placeholder" className="flex flex-wrap items-center gap-1.5">
                {PLACEHOLDERS.map((chip) => (
                  <button
                    key={chip.token}
                    type="button"
                    title={chip.meaning}
                    onClick={() => insertChip(chip.token)}
                    className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-ink outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2"
                  >
                    {chip.token}
                  </button>
                ))}
              </div>
            ) : null}
            <Textarea
              ref={promptRef}
              aria-labelledby={`${ids}-prompt`}
              rows={4}
              spellCheck={false}
              value={prompt}
              aria-invalid={errors.prompt === undefined ? undefined : true}
              onChange={(event) => setPrompt(event.target.value)}
              className="font-mono"
            />
          </Row>
        </ul>
      </section>

      <section aria-labelledby={`${ids}-where`}>
        <h3 id={`${ids}-where`} className={GROUP}>
          Where and with what
        </h3>
        <ul className="flex flex-col">
          <Row
            label="Folder"
            labelId={`${ids}-folder`}
            error={errors.folder}
            control={
              <>
                <span className={cn("font-mono text-sm", folder === null && "text-faint")}>{folder ?? "none"}</span>
                <Button size="sm" onClick={() => setBrowsing(true)}>
                  Change…
                </Button>
                {folder === null ? null : (
                  <Button size="sm" kind="ghost" onClick={() => setFolder(null)}>
                    Clear
                  </Button>
                )}
              </>
            }
            hint="The session starts here, and sees this folder's skills and settings."
          >
            {browsing ? (
              <div className="rounded-lg border border-line">
                {folderBrowser({
                  onPick: (path) => {
                    setFolder(path);
                    setBrowsing(false);
                  },
                  onCancel: () => setBrowsing(false),
                })}
              </div>
            ) : null}
          </Row>
          <Row label="Model" labelId={`${ids}-model`} error={errors.model} control={modelPick({ value: model, onPick: setModel })} hint="Left on the default, the routine uses what a new session uses." />
          <Row label="MCP servers" labelId={`${ids}-mcp`} error={errors.mcp} hint="Servers that start on demand are turned on for this routine's session.">
            {known.length === 0 ? (
              <p className="text-sm text-muted">No servers are set up.</p>
            ) : (
              <div role="group" aria-labelledby={`${ids}-mcp`} className="flex flex-col gap-1.5">
                {known.map((server) => (
                  <label key={server} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-clay"
                      checked={mcp.includes(server)}
                      onChange={(event) => setMcp(event.target.checked ? [...mcp, server] : mcp.filter((each) => each !== server))}
                    />
                    <span className="font-mono">{server}</span>
                  </label>
                ))}
              </div>
            )}
          </Row>
        </ul>
      </section>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 border-t border-line bg-bg py-3">
        <Button kind="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button kind="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {errors.form === undefined ? null : (
          <p role="alert" className="min-w-0 flex-1 text-sm text-deny wrap-anywhere">
            {errors.form}
          </p>
        )}
      </div>
    </form>
  );
}
