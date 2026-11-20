import { GROUPS, SKILLS_HINT, skillRunAs, skillSummary } from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useSkillList } from "../../store/page-context.tsx";
import type { ListedSkill } from "../../store/skills.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { useNarrow } from "../trace/use-narrow.ts";
import { useSettingsContext, useSettingsFolder } from "./context.ts";
import { newSkillRequestStore, useNewSkillRequest } from "./skill-request.ts";
import { NewSkillDialog } from "./skills/new-skill-dialog.tsx";
import { SkillDetail, SkillDot, skillWord, type SkillTab } from "./skills/skill-detail.tsx";

type Selection = { path: string; tab: SkillTab };

/** The folder a skill's `SKILL.md` is in, from the path of its `SKILL.md`. */
function folderOf(file: string): string {
  return file.replace(/\/SKILL\.md$/, "");
}

/** The folder a group's skills sit in: the parent of the first skill's folder. */
function groupFolder(skills: readonly ListedSkill[]): string {
  const first = skills[0]?.path ?? "";
  return first.slice(0, Math.max(0, first.lastIndexOf("/")));
}

function countLine(skills: readonly ListedSkill[]): string {
  const usable = skills.filter((skill) => skill.usable).length;
  const count = `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`;
  return skills.length === usable ? count : `${count} · ${usable} usable`;
}

/**
 * Every skill the folder sees, with why one is unusable, and one skill's details: the list and the
 * detail of the MCP frame. Skills are edited through the daemon, which refuses a project skill the
 * browser may not write.
 */
export function SkillsSection() {
  const context = useSettingsContext();
  const folder = useSettingsFolder();
  const list = useSkillList(folder);
  const narrow = useNarrow();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const back = useRef<string | null>(null);
  const request = useNewSkillRequest();

  // "New skill…" in the palette asks for the dialog; taking the request is one visit's worth.
  const [seen, setSeen] = useState(false);
  if (request !== seen) {
    setSeen(request);
    if (request) setCreating(true);
  }
  useEffect(() => {
    if (request) newSkillRequestStore.set(false);
  }, [request]);

  const skills = list.data?.skills ?? [];
  const wide = !narrow;
  const chosen = skills.find((skill) => skill.path === selection?.path);
  const shown = chosen ?? (wide ? skills[0] : undefined);
  const tab = chosen === undefined ? "overview" : (selection?.tab ?? "overview");

  useEffect(() => {
    if (selection !== null || back.current === null) return;
    rows.current.get(back.current)?.focus();
    back.current = null;
  }, [selection]);

  const dialog = (
    <NewSkillDialog
      open={creating}
      onOpenChange={setCreating}
      folder={folder}
      onCreated={(file) => {
        setCreating(false);
        setSelection({ path: folderOf(file), tab: "skill-md" });
      }}
    />
  );

  if (list.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(list.error, "Could not read the skills.")}
        </p>
        <Button size="sm" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (list.data === undefined) return <p className="font-mono text-sm text-muted">asking the daemon…</p>;

  const listPane = (
    <SkillList
      skills={skills}
      wide={wide}
      selected={wide ? (shown?.path ?? null) : null}
      register={(path, node) => {
        if (node === null) rows.current.delete(path);
        else rows.current.set(path, node);
      }}
      onNew={() => setCreating(true)}
      onOpen={(skill) => setSelection({ path: skill.path, tab: "overview" })}
    />
  );
  if (shown === undefined) {
    return (
      <>
        {listPane}
        {dialog}
      </>
    );
  }
  const detail = (
    <SkillDetail
      key={shown.path}
      skill={shown}
      cwd={folder}
      sessionId={context?.sessionId ?? null}
      tab={tab}
      onTab={(next) => setSelection({ path: shown.path, tab: next })}
      onBack={
        wide
          ? null
          : () => {
              back.current = shown.path;
              setSelection(null);
            }
      }
      onOpened={(path) => setSelection({ path, tab: "skill-md" })}
    />
  );
  if (!wide) {
    // A narrow window shows the list, or the details in its place.
    return (
      <>
        {chosen === undefined ? listPane : detail}
        {dialog}
      </>
    );
  }
  return (
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="w-mcp-list shrink-0 overflow-y-auto border-r border-line bg-bg p-3">{listPane}</div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5">{detail}</div>
      </div>
      {dialog}
    </>
  );
}

export function SkillList({
  skills,
  wide,
  selected,
  register,
  onNew,
  onOpen,
}: {
  skills: readonly ListedSkill[];
  wide: boolean;
  selected: string | null;
  register: (path: string, node: HTMLButtonElement | null) => void;
  onNew: () => void;
  onOpen: (skill: ListedSkill) => void;
}) {
  const newButton = (
    <Button kind="primary" size="sm" onClick={onNew}>
      <span aria-hidden="true">+</span> New skill
    </Button>
  );
  if (skills.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">0 skills</p>
        <p className="text-sm text-muted">{SKILLS_HINT}</p>
        <div>{newButton}</div>
      </div>
    );
  }
  // The daemon lists the highest source first, so equal sources sit together.
  const groups: { source: ListedSkill["source"]; skills: ListedSkill[] }[] = [];
  for (const skill of skills) {
    const last = groups.at(-1);
    if (last !== undefined && last.source === skill.source) last.skills.push(skill);
    else groups.push({ source: skill.source, skills: [skill] });
  }
  return (
    <div className={cn("flex flex-col", wide ? "gap-3" : "gap-4")}>
      <p className="text-sm text-muted">{countLine(skills)}</p>
      <div className="flex flex-wrap items-center gap-2">{newButton}</div>
      {groups.map((group) => (
        <section key={group.source} data-setting={group.source} aria-label={GROUPS[group.source]} className="flex flex-col gap-2">
          <h3 className="min-w-0 px-2 font-mono text-xs font-normal text-faint">
            {GROUPS[group.source]}
            <span className="block truncate" title={groupFolder(group.skills)}>
              {group.source === "bundled" ? "built in" : groupFolder(group.skills)}
            </span>
          </h3>
          <ul className={cn("flex flex-col", wide ? "gap-0.5" : "gap-2")}>
            {group.skills.map((skill) => {
              const current = selected === skill.path;
              // A broken, disabled or hidden skill says why; the others say how to run them.
              const why = (skill.errors ?? []).length > 0 || skill.disabled === true || Boolean(skill.shadowed_by);
              return (
                <li key={skill.path}>
                  <button
                    type="button"
                    ref={(node) => register(skill.path, node)}
                    onClick={() => onOpen(skill)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-y-0.5 rounded-lg border px-3 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
                      current ? "border-line-strong bg-surface" : wide ? "border-transparent hover:border-line" : "border-line bg-surface hover:border-line-strong",
                      !skill.usable && "opacity-70",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-x-2">
                      <SkillDot skill={skill} />
                      <span className="min-w-0 truncate font-ui text-sm font-medium">{skill.name}</span>
                      <span className="shrink-0 font-mono text-xs whitespace-nowrap text-faint">{skillWord(skill)}</span>
                    </span>
                    <span className={cn("min-w-0 pl-4 font-mono text-xs wrap-anywhere", (skill.errors ?? []).length > 0 ? "text-deny" : "text-muted")}>
                      {why ? skillSummary(skill, "") : skillRunAs(skill)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
