import { AGENT_TEMPLATE, agentActions, agentProblemText, hasUnsavedText, selectionAfter, type AgentActions, type AgentRow } from "@golem/view";
import { useState } from "react";
import type { AgentInfo, AgentsSaveResult } from "../../store/agents.ts";
import { actionErrorText } from "../../store/errors.ts";

export type AgentTab = "overview" | "definition";

/** The text of the file being edited. `name` is the agent it belongs to, or null for a new agent that is not saved yet. */
export interface Draft {
  name: string | null;
  text: string;
  original: string;
  /** Why the last save was refused, one line each. */
  problems: string[];
  /** A thrown failure of the last save. */
  failure: string | null;
}

/** What the page can do to the files. Without these the page only shows them. */
export interface AgentCallbacks {
  /** Saves the text; `name` is the agent being edited, or null for a new one. A refusal is in the result. */
  onSave?: (text: string, name: string | null) => Promise<AgentsSaveResult>;
  onCopy?: (name: string) => Promise<AgentInfo>;
  /** Resolves to what the name means now, or null. */
  onDelete?: (name: string) => Promise<{ agent?: AgentInfo | null }>;
}

/** A state to start in, for the gallery and the tests. */
export type AgentsDemo = "new" | "edit" | "refused" | "delete";

/** What the detail of one agent needs to show and run its actions. */
export interface AgentControls {
  tab: AgentTab;
  onTab: (next: AgentTab) => void;
  /** The text being edited, when it is this agent's. */
  draft: Draft | null;
  can: AgentActions;
  busy: boolean;
  /** A copy or a delete the daemon refused, in words. */
  error: string | null;
  asking: boolean;
  onAsk: () => void;
  onKeepIt: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onCopy: () => void;
  /** Leaving the editor with unsaved text was asked for: the question is on screen. */
  leaving: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
  /** The text box takes the focus when it opens, because the person asked for it. The gallery's seeded editors do not. */
  focusText: boolean;
  /** The Edit button takes the focus once it shows, then calls `editFocused`. */
  focusEdit: boolean;
  editFocused: () => void;
}

const REFUSED_TEXT = AGENT_TEMPLATE.replace("read_file, list_dir, glob, grep", "read_files, list_dir, glob, grep");

function seed(demo: AgentsDemo | undefined, shown: AgentRow | undefined): Draft | null {
  if (demo === "new") return { name: null, text: AGENT_TEMPLATE, original: AGENT_TEMPLATE, problems: [], failure: null };
  if ((demo === "edit" || demo === "refused") && shown?.text != null) {
    const refused = demo === "refused";
    return {
      name: shown.name,
      text: refused ? REFUSED_TEXT : shown.text,
      original: shown.text,
      problems: refused ? [agentProblemText({ message: 'there is no tool named "read_files"', line: 5 })] : [],
      failure: null,
    };
  }
  return null;
}

/**
 * The editing of the agents page: the draft text, the question before a delete or before dropping text, and what
 * runs against the daemon. `select` chooses a row by key, or the first with null.
 */
export function useAgentEditing({
  shown,
  select,
  callbacks,
  demo,
}: {
  shown: AgentRow | undefined;
  select: (key: string | null) => void;
  callbacks: AgentCallbacks;
  demo?: AgentsDemo;
}) {
  const [tab, setTab] = useState<AgentTab>(demo === undefined ? "overview" : "definition");
  const [draft, setDraft] = useState<Draft | null>(() => seed(demo, shown));
  const [asking, setAsking] = useState(demo === "delete");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [focusEdit, setFocusEdit] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [focusNew, setFocusNew] = useState(false);
  const [focusText, setFocusText] = useState(false);

  const creating = draft !== null && draft.name === null;

  function clear(): void {
    setDraft(null);
    setAsking(false);
    setError(null);
    setPending(null);
    setFocusEdit(false);
    setFocusNew(false);
    setFocusText(false);
  }

  /** Runs `go`, after asking when it would drop unsaved text. */
  function guard(go: () => void): void {
    if (draft !== null && hasUnsavedText(draft.text, draft.original)) {
      setPending(() => go);
      return;
    }
    clear();
    go();
  }

  /** Chooses a row (null: the first), showing `next` of it. */
  function choose(key: string | null, next: AgentTab = "overview"): void {
    setTab(next);
    select(key);
  }

  function newAgent(): void {
    guard(() => {
      setTab("definition");
      setFocusText(true);
      setDraft({ name: null, text: AGENT_TEMPLATE, original: AGENT_TEMPLATE, problems: [], failure: null });
    });
  }

  async function save(): Promise<void> {
    if (draft === null || callbacks.onSave === undefined) return;
    const sent = draft;
    setBusy(true);
    try {
      const result = await callbacks.onSave(sent.text, sent.name);
      if (!result.ok) {
        setDraft((now) => (now === null ? now : { ...now, problems: (result.problems ?? []).map(agentProblemText), failure: null }));
        return;
      }
      clear();
      setFocusEdit(true);
      choose(selectionAfter(result.agent), "definition");
    } catch (failure) {
      setDraft((now) => (now === null ? now : { ...now, problems: [], failure: actionErrorText(failure, "Could not reach the daemon.") }));
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (shown === undefined || callbacks.onCopy === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const made = await callbacks.onCopy(shown.name);
      setFocusEdit(true);
      choose(selectionAfter(made), "definition");
    } catch (failure) {
      setError(actionErrorText(failure, `Could not copy ${shown.name}.`));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (shown === undefined || callbacks.onDelete === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callbacks.onDelete(shown.name);
      setAsking(false);
      const next = selectionAfter(result.agent);
      setFocusRow(next ?? "");
      choose(next, "overview");
    } catch (failure) {
      setAsking(false);
      setError(actionErrorText(failure, `Could not delete ${shown.name}.`));
    } finally {
      setBusy(false);
    }
  }

  function cancel(): void {
    const wasNew = draft?.name === null;
    // Cancel is the way to drop the text on purpose, so it does not ask.
    clear();
    if (wasNew) setFocusNew(true);
    else setFocusEdit(true);
  }

  const here = draft !== null && (draft.name === null || draft.name === shown?.name) ? draft : null;
  const can = shown === undefined || callbacks.onSave === undefined ? agentActions("project", false) : agentActions(shown.source, shown.text !== null);
  const controls: AgentControls = {
    tab,
    onTab: (next) => {
      guard(() => {
        setTab(next);
      });
    },
    draft: here,
    can: {
      copy: can.copy && callbacks.onCopy !== undefined,
      edit: can.edit && callbacks.onSave !== undefined,
      remove: can.remove && callbacks.onDelete !== undefined,
    },
    busy,
    error,
    asking,
    onAsk: () => {
      setAsking(true);
      setError(null);
    },
    onKeepIt: () => {
      setAsking(false);
    },
    onRemove: () => void remove(),
    onEdit: () => {
      if (shown?.text == null) return;
      setError(null);
      setFocusText(true);
      setDraft({ name: shown.name, text: shown.text, original: shown.text, problems: [], failure: null });
    },
    onText: (text) => {
      setDraft((now) => (now === null ? now : { ...now, text }));
    },
    onSave: () => void save(),
    onCancel: cancel,
    onCopy: () => void copy(),
    leaving: pending !== null,
    onDiscard: () => {
      const go = pending;
      clear();
      go?.();
    },
    onKeepEditing: () => {
      setPending(null);
    },
    focusText,
    focusEdit,
    editFocused: () => {
      setFocusEdit(false);
    },
  };
  return {
    controls,
    draft,
    creating,
    guard,
    choose,
    newAgent,
    focusRow,
    rowFocused: () => {
      setFocusRow(null);
    },
    focusNew,
    newFocused: () => {
      setFocusNew(false);
    },
  };
}
