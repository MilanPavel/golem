import { GROUPS, skillFacts, skillIssues, skillMark, skillRunAs, skillStatusWord } from "@golem/view";
import { useState } from "react";
import { NEW_DRAFT_KEY } from "../../../store/drafts.ts";
import { useDraft, useNavigate, usePageActions } from "../../../store/page-context.tsx";
import { skillErrorText, type ListedSkill } from "../../../store/skills.ts";
import { Badge } from "../../../ui/badge.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { IconButton } from "../../../ui/icon-button.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../../ui/menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs.tsx";
import { SkillEditor } from "./skill-editor.tsx";

export type SkillTab = "overview" | "skill-md";

/** The dot of a row or a header: the mark's tone, and an outline for a skill another one hides. */
export function SkillDot({ skill }: { skill: ListedSkill }) {
  const tone = skillMark(skill).tone;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-xs",
        tone === "ok" && "bg-allow",
        tone === "bad" && "bg-deny",
        tone === "wait" && "bg-wait",
        tone === "off" && (skill.shadowed_by ? "border border-faint" : "bg-line-strong"),
      )}
    />
  );
}

/** The short word of a row. The long one is the detail's Status. */
export function skillWord(skill: ListedSkill): string {
  if ((skill.errors ?? []).length > 0) return "broken";
  if (skill.disabled) return "disabled";
  if (skill.shadowed_by) return "hidden";
  return (skill.warnings ?? []).length > 0 ? "warnings" : "usable";
}

type Fact = { label: string; text: string; note: string };

/** The facts as the Tune view groups them: a heading, then dashed rows, each with a line of what it means. */
function groups(skill: ListedSkill): { title: string; rows: Fact[] }[] {
  const facts = new Map(skillFacts(skill, "").map((fact) => [fact.label, fact.text]));
  const row = (label: string, note: string, text = facts.get(label)): Fact[] => (text === undefined ? [] : [{ label, text, note }]);
  const indexed = skill.indexed === undefined ? undefined : skill.indexed ? "yes" : "no";
  return [
    {
      title: "About",
      rows: [...row("Status", "Why it is, or is not, in use."), ...row("Description", "What the model reads to decide when it fits.")],
    },
    {
      title: "When it runs",
      rows: [
        ...row("You run it", "Type / in any chat, or press Run in a new chat."),
        ...row("Model uses it", "golem can pick it when a request fits its description. Off means only you can run it."),
        ...row("In the index", "The model sees the name and description on every turn.", indexed),
      ],
    },
    {
      title: "What it may do",
      rows: [
        ...row("Allowed tools", "Approved while the skill runs. A deny rule always wins."),
        ...row("Model", "The model it asks for."),
      ],
    },
    {
      title: "Where",
      rows: [
        ...row("Folder", "The skill and everything beside it."),
        ...row("From", "Where it is loaded from.", GROUPS[skill.source]),
        ...row("Shadows", "Another skill of this name hides this one.", skill.shadowed_by ?? undefined),
      ],
    },
  ].filter((group) => group.rows.length > 0);
}

export function SkillOverview({ skill }: { skill: ListedSkill }) {
  const issues = skillIssues(skill);
  return (
    <div className="flex flex-col gap-1 pt-1">
      {groups(skill).map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h4 className="mb-1 mt-4 border-b border-line pb-1 font-mono text-xs tracking-wider text-faint uppercase first:mt-0">{group.title}</h4>
          <ul className="flex flex-col">
            {group.rows.map((fact) => (
              <li key={fact.label} className="flex flex-col gap-1 border-t border-dashed border-line py-2 first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-ink">{fact.label}</span>
                  <span className="ml-auto min-w-0 text-right font-mono text-sm text-ink wrap-anywhere">{fact.text}</span>
                </div>
                <p className="text-xs text-muted">{fact.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {(["bad", "wait"] as const).map((tone) => {
        const items = issues.filter((issue) => issue.tone === tone);
        if (items.length === 0) return null;
        const title = tone === "bad" ? "Errors" : "Warnings";
        return (
          <section key={tone} aria-label={title}>
            <h4 className="mb-1 mt-4 border-b border-line pb-1 font-mono text-xs tracking-wider text-faint uppercase">{title}</h4>
            <ul className="flex flex-col gap-1">
              {items.map((issue, at) => (
                <li key={at} className={cn("font-mono text-xs wrap-anywhere", tone === "bad" ? "text-deny" : "text-wait")}>
                  <span aria-hidden="true">{tone === "bad" ? "✘ " : "! "}</span>
                  {issue.text}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * One skill: its header and actions, then the Overview and the SKILL.md tab. Text from the skill's
 * frontmatter is shown as text nodes only, never as Markdown or HTML.
 */
export function SkillDetail({
  skill,
  cwd,
  sessionId,
  tab,
  onTab,
  onBack,
  onOpened,
}: {
  skill: ListedSkill;
  cwd: string | null;
  /** The chat Settings was opened from, for "Pin in this chat". */
  sessionId: string | null;
  tab: SkillTab;
  onTab: (tab: SkillTab) => void;
  onBack: (() => void) | null;
  /** A copy of a bundled skill was made: its folder. */
  onOpened: (folder: string) => void;
}) {
  const actions = usePageActions();
  const navigate = useNavigate();
  const [, setDraft] = useDraft(NEW_DRAFT_KEY);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bundled = skill.source === "bundled";
  const hidden = Boolean(skill.shadowed_by);
  const runnable = skill.usable && skill.user_invocable !== false;

  async function attempt(work: () => Promise<void>, fallback: string): Promise<void> {
    try {
      await work();
      setError(null);
    } catch (failure) {
      setNotice(null);
      setError(skillErrorText(failure, fallback));
    }
  }

  const toggleDisabled = (): Promise<void> =>
    attempt(async () => {
      await actions.setSkillDisabled(skill.name, skill.disabled !== true);
      setNotice(skill.disabled === true ? `${skill.name} is on` : `${skill.name} is disabled`);
    }, `Could not change ${skill.name}.`);

  const pin = (): Promise<void> =>
    attempt(async () => {
      if (sessionId === null) return;
      await actions.pinSkill(sessionId, skill.name, true);
      setNotice(`${skill.name} is pinned in this chat`);
    }, `Could not pin ${skill.name}.`);

  /** A bundled skill is copied to Yours: the folder, the file, then its text. */
  const copy = (): Promise<void> =>
    attempt(async () => {
      const source = await actions.readSkill(skill.name, cwd);
      const created = await actions.createSkill({
        name: skill.name,
        description: skill.description,
        scope: "user",
        cwd: null,
        modelInvocable: skill.model_invocable !== false,
      });
      await actions.writeSkill({ path: created.path, text: source.text, baseMtimeNs: created.mtime_ns, cwd, dryRun: false });
      onOpened(created.path.replace(/\/SKILL\.md$/, ""));
    }, `Could not copy ${skill.name}.`);

  const runInNewChat = (): void => {
    setDraft(`/${skill.name} `);
    navigate("/");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {onBack === null ? null : (
        <div>
          <Button size="sm" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <h3 className="font-ui text-lg font-semibold wrap-anywhere">{skill.name}</h3>
          <p className="font-mono text-xs text-muted wrap-anywhere">{`${skill.path}/SKILL.md`}</p>
          <p className="font-mono text-xs text-muted">{GROUPS[skill.source]}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1.5">
          <p className="flex items-center gap-2 font-mono text-xs text-muted">
            <SkillDot skill={skill} />
            {skillStatusWord(skill, "")}
          </p>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge tone={skill.model_invocable === false ? "neutral" : "clay"} className="py-0">
              {skill.model_invocable === false ? "only you" : "model uses it"}
            </Badge>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Button kind="primary" size="sm" disabled={!runnable} onClick={runInNewChat} title={`Starts a new chat with ${skillRunAs(skill)}`}>
          Run in a new chat
        </Button>
        {sessionId === null ? null : (
          <Button size="sm" disabled={!skill.usable} onClick={() => void pin()}>
            Pin in this chat
          </Button>
        )}
        {bundled ? (
          <Button size="sm" onClick={() => void copy()}>
            Copy to Yours
          </Button>
        ) : (
          <Button size="sm" disabled={hidden} onClick={() => onTab("skill-md")}>
            Edit
          </Button>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`More actions for ${skill.name}`}>
              <span aria-hidden="true">⋯</span>
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => void toggleDisabled()}>{skill.disabled === true ? "Enable" : "Disable"}</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <p role="status" aria-live="polite" className="font-mono text-xs text-muted empty:hidden">
        {notice}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <Tabs value={tab} onValueChange={(next) => onTab(next as SkillTab)} className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList aria-label={`${skill.name} details`}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="skill-md">SKILL.md</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <SkillOverview skill={skill} />
        </TabsContent>
        <TabsContent value="skill-md" className="flex min-h-0 flex-1 flex-col">
          <SkillEditor skill={skill} cwd={cwd} onCopy={() => void copy()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
