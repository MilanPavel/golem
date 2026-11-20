import { useId, useState } from "react";
import { usePageActions } from "../../../store/page-context.tsx";
import { SKILL_NAME, skillErrorText } from "../../../store/skills.ts";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { cn } from "../../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog.tsx";
import { Input } from "../../../ui/input.tsx";
import { Textarea } from "../../../ui/textarea.tsx";

type Scope = "user" | "project";

/** The folder `skill.create` makes a skill in, in words. */
const WHERE: Record<Scope, string> = { user: "~/.golem/skills", project: ".agents/skills" };

/**
 * The New skill dialog: a name, where it lives, a description, and whether the model may use it.
 * "Write it myself" makes the folder and its `SKILL.md`; `onCreated` gets the path of the new `SKILL.md`.
 */
export function NewSkillDialog({
  open,
  onOpenChange,
  folder,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project folder, or null when no session or new-session folder is known. */
  folder: string | null;
  onCreated: (path: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>New skill</DialogTitle>
        <DialogDescription>A skill is a SKILL.md you run with /name, and the model can pick when it fits.</DialogDescription>
        {/* The form is mounted only while open, so each opening starts empty. */}
        {open ? <Form folder={folder} onCancel={() => onOpenChange(false)} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ folder, onCancel, onCreated }: { folder: string | null; onCancel: () => void; onCreated: (path: string) => void }) {
  const actions = usePageActions();
  const ids = useId();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("user");
  const [description, setDescription] = useState("");
  const [modelUses, setModelUses] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameError = name === "" || SKILL_NAME.test(name) ? null : "Use lowercase letters, digits and dashes.";
  const ready = SKILL_NAME.test(name) && description.trim() !== "" && !busy;

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await actions.createSkill({
        name,
        description: description.trim(),
        scope,
        cwd: scope === "project" ? folder : null,
        modelInvocable: modelUses,
      });
      onCreated(created.path);
    } catch (failure) {
      setError(skillErrorText(failure, "Could not create the skill."));
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void create();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-name`} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="release-notes"
          aria-invalid={nameError !== null}
          aria-describedby={nameError === null ? undefined : `${ids}-name-error`}
          onChange={(event) => setName(event.target.value)}
        />
        {nameError === null ? null : (
          <p id={`${ids}-name-error`} className="text-xs text-deny">
            {nameError}
          </p>
        )}
      </div>
      <div role="group" aria-label="Where" className="flex flex-col gap-1">
        <span className="text-sm font-medium">Where</span>
        <div className="flex gap-2">
          <Button size="sm" aria-pressed={scope === "user"} onClick={() => setScope("user")}>
            Yours
          </Button>
          <Button
            size="sm"
            aria-pressed={scope === "project"}
            disabled={folder === null}
            title={folder === null ? "Open Settings from a chat to add a skill to its project." : undefined}
            onClick={() => setScope("project")}
          >
            This project
          </Button>
        </div>
        <p className="text-meta text-muted wrap-anywhere"><Code tone="muted">{scope === "project" && folder !== null ? `${folder}/${WHERE.project}` : WHERE[scope]}</Code></p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-description`} className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id={`${ids}-description`}
          value={description}
          rows={2}
          placeholder="Summarise what changed since the last release tag."
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={modelUses}
          aria-label="Let the model use it"
          onClick={() => setModelUses((now) => !now)}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full outline-offset-2 outline-clay focus-visible:outline-2",
            modelUses ? "bg-clay" : "bg-line-strong",
          )}
        >
          <span aria-hidden="true" className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform motion-reduce:transition-none", modelUses && "translate-x-4")} />
        </button>
        <span className="text-sm">Let the model use it</span>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled title="Comes with 2.7" aria-describedby={`${ids}-ask`}>
          Ask golem to write it
        </Button>
        <Button type="submit" kind="primary" disabled={!ready}>
          Write it myself
        </Button>
      </div>
      <p id={`${ids}-ask`} className="text-right text-xs text-muted">
        Asking golem to write it comes with 2.7.
      </p>
    </form>
  );
}
