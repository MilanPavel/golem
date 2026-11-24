import { helperCardOf, agentRow, signInLine, type SignInLine, checksSummary, COMMANDS, mcpStatusWord, noPastes, pickerGroups, withModelChoices, withSkillChoices, type CheckRun, type ChecksState, type ReviewNote, type TodoItem, type TurnChecks, type TurnCard, type ChatMessage, type ChatState, type RewindPlan, ladderRows, NO_LOCAL_WINDOW, routeRows, spendRows, contextActions, bestActions, windowSourceOf, helperBanner, helperReceipt, type ContextActionsInput, type PermissionMode } from "@golem/view";
import type { ListedModel } from "@golem/client";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { CopyButton, CopyCommand } from "../ui/copy-command.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog.tsx";
import { GOLEM_STATE_LABEL, type GolemState } from "../ui/golem-state.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { CheckIcon, ChevronDownIcon, CloseIcon, CopyIcon, PlusIcon, SearchIcon, SendIcon, StopIcon } from "../ui/icons.tsx";
import { Input } from "../ui/input.tsx";
import { Code } from "../ui/code.tsx";
import { Kbd } from "../ui/kbd.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { PixelGolem } from "../ui/pixel-golem.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { StatusDot } from "../ui/status-dot.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import { Dot, serverSummary, SignInPanel, type Login } from "../features/settings/mcp/sign-in.tsx";
import { StoredValue, TokenTestView, type TokenTest } from "../features/settings/mcp/edit-form.tsx";
import { TokenLine } from "../features/settings/mcp/token-line.tsx";
import type { McpServer } from "../store/mcp.ts";
import { ConnectionScreen } from "../features/connection/connection-screen.tsx";
import { connectionScreen, type ConnectionHost } from "../features/connection/connection-screen.ts";
import { ChecksStrip, EditCards, ToolLine, TranscriptMessages, WritingRow, type TurnUndo } from "../features/chat/index.ts";
import { COST_CASES, CUT_REPLY, SAMPLE_CHAT, SAMPLE_TOOLS, THINKING_CASES, TURN_CHAT, NOTICE_CHAT, ROUTED_CASES, ROUTED_SESSION } from "../features/chat/sample.ts";
import { ApprovalBar } from "../features/approval/index.ts";
import { DockCounter } from "../features/approval/dock-counter.tsx";
import { HelperBatchCard } from "../features/approval/helper-batch-card.tsx";
import { HelperQuestion } from "../features/approval/helper-question.tsx";
import { UseHelpers } from "../features/settings/use-helpers-setting.tsx";
import { ConsentBar } from "../features/consent/consent-bar.tsx";
import { ANSWERED, PENDING_EDIT, PENDING_SHELL } from "../features/approval/sample.ts";
import { DiffModeSwitch, DiffView } from "../features/diff/index.ts";
import { SAMPLE_EDIT_DIFF, SAMPLE_LONG_LINE_DIFF, SAMPLE_NEW_FILE_DIFF } from "../features/diff/sample.ts";
import { TodoList } from "../features/drawer/index.ts";
import { DiffPanel } from "../features/workbench/file-row.tsx";
import { rowKey } from "../features/workbench/turns-view.tsx";
import { cloudFinishedChat, cloudRunningChat, localFinishedChat, localRunningChat, STEPS_NOW } from "../features/workbench/steps-sample.ts";
import { StepsView, stepsBatches } from "../features/workbench/steps-tab.tsx";
import { ChangesView, ChecksView, Workbench, type WorkbenchTab, CommitDialogView, ConflictDialogView, RewindDialogView, TurnsView, FilesView } from "../features/workbench/index.ts";
import type { ChangedFile } from "../store/changes.ts";
import { BranchChipView, BranchSwitchLineView, Composer, ContextBannerView, ContextChipView, DockView, Meter, FolderBarBadge, SessionFolderMenuBody, ModeChipView, ModelBarChipView, NotesChipView, ChecksQuestionView, RoutePanelView, WaitHintView } from "../features/composer/index.ts";
import { PlanCardView } from "../features/chat/plan-card.tsx";
import { createHistory } from "../features/composer/history.ts";
import { CommandsDialog } from "../features/composer/help-dialog.tsx";
import { HomeView, NewSessionModelChipView, SessionTitle } from "../features/shell/index.ts";
import { FolderChip } from "../features/shell/folder-chip.tsx";
import { FolderMenuBody } from "../features/shell/folder-menu.tsx";
import { FolderBrowserView } from "../features/shell/folder-browser.tsx";
import { CommandPaletteView, KeysDialog } from "../features/palette/index.ts";
import { ModelDialogView, ModelList, withActivePulls, type ModelDialogViewProps, type ModelListNote } from "../features/models/index.ts";
import { sampleTry, sampleTuneBackend } from "../features/models/sample-tune.ts";
import { FinishSetupStripView, WelcomeView } from "../features/welcome/index.ts";
import { WELCOME_CASES } from "../features/welcome/sample.ts";
import { SpanDetail, TraceSummary, TraceTree } from "../features/trace/index.ts";
import { APPROVAL_DETAIL, APPROVAL_TRACE, CLEARED_DETAIL, GROWING_EVENTS, CUT_LIKELY_DETAIL, CUT_MIDDLE_DETAIL, CUT_YES_DETAIL, FULL_DETAIL, MODEL_DETAIL, NO_PROMPT_DETAIL, NUM_CTX_DETAIL, OLD_DETAIL, SECTIONS_DETAIL, TOOL_DETAIL, UNKNOWN_WINDOW_DETAIL, FAILED_TRACE, GROWING_TRACE, LONG_TRACE, OLD_TRACE, SHORT_TRACE } from "../features/trace/sample.ts";
import type { TraceContextEvent, TraceRunSpan, TraceSpanResult } from "../store/trace.ts";
import { FORM_CASES } from "../features/setup/sample.ts";
import { HeroCard, PathsGrid } from "../features/setup/info-parts.tsx";
import { HowFarView } from "../features/settings/chat-alone.tsx";
import { ChatSection } from "../features/settings/chat-section.tsx";
import { Stage, YouRow } from "../features/settings/chat-stage.tsx";
import { InstructionsView } from "../features/settings/chat-instructions.tsx";
import { ModelsView } from "../features/settings/models/models-view.tsx";
import { GET_CASES, HF_FAILED, IDLE_SETUP, MODELS_CASES, NO_ACTIONS, NO_PULLS } from "../features/settings/models/models-sample.ts";
import { MemoryView } from "../features/settings/memory/memory-view.tsx";
import { SAMPLE_MEMORIES, SAMPLE_MEMORY_COUNTS, SAMPLE_MEMORY_SETTINGS } from "../features/settings/memory/sample.ts";
import { MEMORY_OFF_TEXT } from "../store/memory.ts";
import { DefaultLimits, FinishedHelpers } from "../features/settings/agents-keep.tsx";
import { LimitsBlock } from "../features/settings/agents-limits.tsx";
import { AgentsPage, AgentsTabs } from "../features/settings/agents-section.tsx";
import { MeasureListView } from "../features/settings/measure-list.tsx";
import { MeasureRunView } from "../features/settings/measure-run.tsx";
import { SAMPLE_ARMS, SAMPLE_ARMS_NO_ROOM, SAMPLE_ASKS, SAMPLE_DONE, SAMPLE_HISTORY, SAMPLE_HISTORY_RUNNING, SAMPLE_LIVE, SAMPLE_RUNNING, SAMPLE_STOPPED, SAMPLE_STOPPED_OWN_RISK } from "../features/settings/measure-sample.ts";
import { SAMPLE_AGENTS, SAMPLE_CONFIG_LIMITS, SAMPLE_DELEGATE, SAMPLE_DELEGATE_CHANGED, SAMPLE_COPY, WISH_AGENTS_CLOUD, WISH_AGENTS_LOCAL, WISH_AGENTS_MIXED } from "../features/settings/agents-sample.ts";
import { SkillList } from "../features/settings/skills-section.tsx";
import { SkillOverview } from "../features/settings/skills/skill-detail.tsx";
import { SAMPLE_BROKEN_SKILL_MD, SAMPLE_SKILLS } from "../features/settings/skills/sample.ts";
import { ContextView } from "../features/settings/context-section.tsx";
import { CONTEXT_CASES, PLANNED_WINDOW } from "../features/settings/context-sample.ts";
import { RoutingView } from "../features/settings/routing-section.tsx";
import { ROUTING_CASES, ROUTING_LISTING } from "../features/settings/routing-sample.ts";
import { UsageView } from "../features/settings/usage-section.tsx";
import { EMPTY_USAGE, SAMPLE_USAGE, SAMPLE_USAGE_WITH_HELPERS } from "../features/settings/usage-sample.ts";
import { CodeEditor } from "../features/settings/config/code-editor.tsx";
import { CatalogView } from "../features/settings/mcp/catalog-panel.tsx";
import { ImportListView } from "../features/settings/mcp/import-panel.tsx";
import { SAMPLE_CATALOG, SAMPLE_SCAN } from "../features/settings/mcp/sample.ts";
import { SetupFormView } from "../features/setup/setup-form.tsx";
import { ToolsOfferView } from "../features/setup/tools-offer.tsx";
import { TOOLS_CASES } from "../features/setup/tools-sample.ts";
import { PullStatusView, pullSummary } from "../features/models/index.ts";
import { NO_OLLAMA_LISTING, OLLAMA_DOWN_LISTING, SAMPLE_LISTING, SAMPLE_PULLS, STARRED_LISTING, THINKING_LISTING, UNSTARRED_LISTING } from "../features/models/sample.ts";
import { CloseSessionDialog, HelperBannerBar, HelperPanelView, HelperReceiptCard, RenameField, type HelperView } from "../features/sessions/index.ts";
import { ALL_CLOUD, ALL_LOCAL, askingBatchChat, cloudBatchChat, localBatchChat } from "../features/chat/helper-card-sample.ts";
import { ASKING_HELPER, DONE_HELPER, HELPER_NOW, RUNNING_HELPER, TRIMMED_AT, TRIMMED_HELPER } from "../features/sessions/helper-sample.ts";
import { RoutineDetail, RoutinesEmpty, RoutinesPanel } from "../features/routines/index.ts";
import { SAMPLE_LIST, SAMPLE_MORNING_BRIEF, ROUTINES_NOW, SAMPLE_RUNS } from "../features/routines/sample.ts";
import { LeadRun, RunBanner, RunsList, RunsPanel } from "../features/runs/index.ts";
import { RUNS_NOW, SAMPLE_RUN_LIST, SAMPLE_WAITING_RUN } from "../features/runs/sample.ts";
import { HelperRowCardBody, Rail, SessionsPanel, SidebarPanel, WaitingChip } from "../features/sidebar/index.ts";
import { ConnectionStrip } from "../features/connection/index.ts";
import { InboxPanel } from "../features/inbox/index.ts";
import { SAMPLE_HELPER_CONSENT, SAMPLE_HELPER_GROUPS, SAMPLE_HELPER_INBOX, SAMPLE_INBOX } from "../features/inbox/sample.ts";
import { inboxKey } from "../store/inbox.ts";
import { faviconHref, tabTitle } from "../features/tab-status/index.ts";
import type { ConnectionSnapshot } from "../store/connection.ts";
import type { SessionSummary } from "../store/session-list.ts";
import { ThemeSwitch } from "../theme-switch.tsx";

const SNAPSHOTS: ConnectionSnapshot[] = [
  { state: { status: "connecting" }, daemonVersion: null },
  { state: { status: "unauthorized" }, daemonVersion: null },
  { state: { status: "rejected", reason: "protocol major mismatch: client 2, daemon 1" }, daemonVersion: null },
  { state: { status: "reconnecting", attempt: 4, delayMs: 2000, closeCode: 1013 }, daemonVersion: null },
  { state: { status: "reconnecting", attempt: 2, delayMs: 1000 }, daemonVersion: null },
  { state: { status: "closed", reason: "closed" }, daemonVersion: null },
];

const GATEWAY_DOWN: ConnectionSnapshot = { state: { status: "reconnecting", attempt: 2, delayMs: 1000 }, daemonVersion: null };

/** The screens with what the page knows of its gateway's job: unknown, then restarting, overdue, and no job. */
const SCREENS: [ConnectionSnapshot, ConnectionHost][] = [
  ...SNAPSHOTS.map((snapshot): [ConnectionSnapshot, ConnectionHost] => [snapshot, { kept: null, overdue: false }]),
  [GATEWAY_DOWN, { kept: true, overdue: false }],
  [GATEWAY_DOWN, { kept: true, overdue: true }],
  [GATEWAY_DOWN, { kept: false, overdue: false }],
];

const GALLERY_MODELS: ListedModel[] = [
  { ref: "ollama/qwen3:27b", label: "qwen3:27b", provider: "ollama", source: "installed", status: "ready", tier: "local", ctx: 32768, price: { input: 0, output: 0 } },
  { ref: "deepseek/deepseek-chat", label: "deepseek-chat", provider: "deepseek", source: "remote", status: "ready", tier: "budget", tools: true, price: { input: 0.28, output: 1.1 } },
];
const GALLERY_COST = {
  today: { calls: 4, input: 9000, output: 800, cost_usd: 0.42, saved_usd: 0.1 },
  week: { calls: 9, input: 20000, output: 2000, cost_usd: 0.9, saved_usd: 0.3 },
  session: { calls: 2, input: 3000, output: 300, cost_usd: 0.03, saved_usd: 0 },
};
const GALLERY_OWN = { profile: "local", provider: "ollama", name: "qwen3:27b", tier: "local" } as const;
const ROUTE_CHIP_CASES = [
  { label: "pinned, with caps", mode: "pinned", ladder: routeRows("pinned", GALLERY_MODELS, null, GALLERY_OWN), spend: spendRows(GALLERY_COST, { ladder: {}, daily_usd: 2, session_usd: 0.5 }) },
  { label: "local only, no caps", mode: "local", ladder: routeRows("local", GALLERY_MODELS, null, GALLERY_OWN), spend: spendRows(GALLERY_COST, { ladder: {} }) },
  { label: "auto, a tier without a key", mode: "auto", ladder: ladderRows([GALLERY_MODELS[0]!, { ...GALLERY_MODELS[1]!, status: "needs_key" }], null, GALLERY_OWN), spend: spendRows(GALLERY_COST, { ladder: {}, daily_usd: 2 }) },
] as const;

/** Six turns with a 3K tool result each: enough to clear and to summarise. */
const CTX_MESSAGES: ContextActionsInput["messages"] = Array.from({ length: 6 }, () => [
  { role: "user" as const, text: "read it", tokens: 100 },
  { role: "assistant" as const, text: "reading", tokens: 100 },
  { role: "tool" as const, text: "file", tokens: 3000 },
]).flat();
const CTX_BIG_MODEL: ListedModel = { ref: "ollama/qwen3:27b", label: "qwen3:27b", provider: "ollama", source: "installed", status: "ready", tier: "local", ctx: 131072, price: { input: 0, output: 0 } };
const CTX_MEMORY = { ram_gb: 32, size_gb: 16, kv_gb_per_1k_tokens: 0.06, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };
/** Your instructions with its lines held in the page, and what the model reads made from them. */
function GalleryInstructions() {
  const [lines, setLines] = useState<string[]>(["Keep answers short: the answer first, then stop."]);
  const [shown, setShown] = useState<string[] | null>(null);
  const text = (shown ?? lines).map((line) => line.trim()).filter((line) => line !== "").join("\n");
  const instructions = text === "" ? [] : [{ name: "instructions", text, tokens: Math.ceil(text.length / 4) }];
  const parts = [
    ...instructions,
    { name: "memory", text: "Notes you and golem wrote: you like metric units.", tokens: 14 },
    { name: "skill_index", text: "Skills you can use: summarise a page, plan a trip.", tokens: 16 },
    { name: "plan_first", text: "Show a short plan first and wait for a yes.", tokens: 12 },
  ];
  const tools = 1100;
  const prompt = { model: "ollama/qwen3", parts, tools_tokens: tools, total_tokens: parts.reduce((all, part) => all + part.tokens, tools) };
  return (
    <InstructionsView
      saved={lines}
      onSave={async (next) => {
        setLines(next);
        return null;
      }}
      onDraft={async () => ({ lines: ["Be direct. No pleasantries, no praise, no offers at the end.", "Use metric units.", "Explain a term the first time you use it."], model: "ollama/qwen3" })}
      onPreview={setShown}
      prompt={prompt}
      promptError={null}
      onNavigate={() => undefined}
      suggestions={{
        suggestions: [
          { line: "Keep answers short.", reason: "You said “shorter” or “tl;dr” in 4 chats this week.", source: "chats" },
          { line: "Prefer bullet points to long paragraphs.", reason: "From memory: “Prefers bullet points over long paragraphs.”", source: "memory" },
        ],
        updated: "2026-11-22T08:00:00Z",
        needs_local_model: false,
      }}
      onDismiss={async () => undefined}
    />
  );
}

/** Settings › Chat with its defaults held in the page, as the daemon would hold them. */
function GalleryChatSettings() {
  const [mode, setMode] = useState<PermissionMode>("balanced");
  const [plan, setPlan] = useState(false);
  return <ChatSection instructions={<GalleryInstructions />} alone={<HowFarView mode={mode} planFirst={plan} onMode={setMode} onPlan={setPlan} />} />;
}

function ctxCase(label: string, used: number, window: number | null, extra: Partial<ContextActionsInput> = {}) {
  const planned = extra.session?.provider !== "deepseek" && window !== null;
  const source = extra.source ?? windowSourceOf({ window, planned, numCtx: null });
  const actions = contextActions({
    used,
    window,
    source,
    session: { profile: null, provider: "ollama", name: "qwen3:27b" },
    models: [CTX_BIG_MODEL, ...GALLERY_MODELS.slice(1)],
    messages: CTX_MESSAGES,
    keepResults: 4,
    keepTurns: 4,
    memory: CTX_MEMORY,
    route: "pinned",
    busy: false,
    ...extra,
  });
  return { label, used, window, source, actions };
}
const CONTEXT_CHIP_CASES = [
  ctxCase("normal", 14000, 32768),
  ctxCase("high, with a suggestion", 27000, 32768),
  ctxCase("full", 31500, 32768),
  ctxCase("hosted model, no grow row", 90000, 128000, { session: { profile: null, provider: "deepseek", name: "deepseek-chat" } }),
  ctxCase("unknown window", 1300, null),
];

const NOW = Date.parse("2026-11-01T12:00:00Z");

function fakeSession(
  id: string,
  title: string | null,
  cwd: string | null,
  status: SessionSummary["status"],
  minutesAgo: number,
  forkedFrom?: string,
  origin?: string,
): SessionSummary {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  const base = { session_id: id, created_at: at, updated_at: at, last_seq: 1, model_profile: "default", status, cwd, title };
  const forked = forkedFrom === undefined ? base : { ...base, forked_from: forkedFrom };
  return origin === undefined ? forked : { ...forked, origin };
}

const SESSIONS: SessionSummary[] = [
  fakeSession("a", "UTF-8 split in the socket client", "/Users/you/repos/golem", "waiting", 0),
  fakeSession("b", "ADR-028: the web gateway", "/Users/you/repos/golem", "running", 2),
  { ...fakeSession("q", "Rename the config keys", "/Users/you/repos/golem", "running", 1), wait_reason: "slot", wait_line: "qwen3:14b" },
  fakeSession("c", "Invoke /ship from the composer", "/Users/you/repos/golem", "idle", 75),
  fakeSession("h", "Same fix, as a table", "/Users/you/repos/golem", "idle", 30, "a"),
  fakeSession("i", "Table with a decoder test", "/Users/you/repos/golem", "idle", 20, "h"),
  fakeSession("j", "Gateway ADR, shorter", "/Users/you/repos/golem", "idle", 90, "gone"),
  fakeSession("d", "Weekday PR digest, draft", "/Users/you/notes", "idle", 60 * 26, undefined, "routine:pr-digest"),
  fakeSession("k", "A very long session title that has to be cut off before it reaches the time", "/Users/you/repos/golem-docs", "idle", 60 * 27),
  fakeSession("e", null, "/Users/you/notes", "idle", 60 * 24 * 12),
  fakeSession("f", "A scratch session", null, "idle", 60 * 24 * 5),
  fakeSession("g", "Closed, so hidden", "/Users/you/notes", "closed", 5),
];

/** Three leads: two helpers working, one asks you, and all done. The open lead shows its helpers as rows. */
const HELPER_SESSIONS: SessionSummary[] = [
  fakeSession("lead-a", "Map the daemon modules", "/Users/you/repos/golem", "running", 1),
  { ...fakeSession("lead-a1", "explorer · routing", "/Users/you/repos/golem", "running", 1), parent_session_id: "lead-a", agent: "explorer" },
  { ...fakeSession("lead-a2", "explorer · titles", "/Users/you/repos/golem", "running", 2), parent_session_id: "lead-a", agent: "explorer" },
  fakeSession("lead-b", "Check the retry code", "/Users/you/repos/golem", "running", 5),
  { ...fakeSession("lead-b1", "explorer · retries", "/Users/you/repos/golem", "waiting", 5), parent_session_id: "lead-b", agent: "explorer" },
  { ...fakeSession("lead-b2", "explorer · backoff", "/Users/you/repos/golem", "running", 6), parent_session_id: "lead-b", agent: "explorer" },
  fakeSession("lead-c", "Read the ADRs", "/Users/you/repos/golem", "idle", 20),
  { ...fakeSession("lead-c1", "explorer · ADR-059", "/Users/you/repos/golem", "idle", 20), parent_session_id: "lead-c", agent: "explorer" },
  { ...fakeSession("lead-c2", "explorer · ADR-060", "/Users/you/repos/golem", "idle", 21), parent_session_id: "lead-c", agent: "explorer" },
];

/** A lead with a helper still working and a fork of it, as the list shows them when the lead is open. */
const HELPER_FORK_SESSIONS: SessionSummary[] = [
  fakeSession("lead-a", "Map the daemon modules", "/Users/you/repos/golem", "running", 1),
  { ...fakeSession("lead-a1", "explorer · routing", "/Users/you/repos/golem", "running", 1), parent_session_id: "lead-a", agent: "explorer" },
  fakeSession("lead-a-fork", "Map the daemon modules (fork)", "/Users/you/repos/golem", "idle", 12, "lead-a"),
];

/** The card on a lead's row: two helpers working, one asks you, one queued. */
const CARD_HELPERS: SessionSummary[] = [
  { ...fakeSession("card-1", "explorer · routing", "/Users/you/repos/golem", "running", 3), parent_session_id: "lead-a", agent: "explorer", step: "read daemon/routing.py" },
  { ...fakeSession("card-2", "explorer · titles", "/Users/you/repos/golem", "running", 2), parent_session_id: "lead-a", agent: "explorer", step: "grep title_of" },
  {
    ...fakeSession("card-3", "explorer · retries", "/Users/you/repos/golem", "waiting", 1),
    parent_session_id: "lead-a",
    agent: "explorer",
    step: "write notes/retry.md",
    pending: { kind: "approval", since: new Date(NOW - 60_000).toISOString(), call_id: "card-call", name: "write_file", subject: "notes/retry.md", source: "built-in default" },
  },
  { ...fakeSession("card-4", "explorer · backoff", "/Users/you/repos/golem", "running", 1), parent_session_id: "lead-a", agent: "explorer", wait_reason: "slot", wait_line: "qwen3:14b" },
];

const CARD_ACTIONS = { open: () => {}, stop: () => Promise.resolve(), answer: () => Promise.resolve() };

const RECONNECTING: ConnectionSnapshot = { state: { status: "reconnecting", attempt: 1, delayMs: 1000 }, daemonVersion: "0.4.0" };

const STATES: GolemState[] = ["idle", "thinking", "waiting", "failed", "offline"];

/** The id a section's heading gives it, such as `Session title, rename, and close` -> `session-title-rename-and-close`. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Both themes are on the page at once, so a section's id would repeat. The kiln panel puts `kiln-`
 * in front, and `#trace` goes to the slip panel. With one theme shown there is no prefix.
 */
const AnchorPrefix = createContext("");

/**
 * The one section to draw, by id without the prefix, or undefined for all of them. A test that checks one
 * section passes `<Gallery only="agents" />`, so it does not render the other 77 and their jsdom nodes.
 */
const OnlySection = createContext<string | undefined>(undefined);

/** Draws its section, or nothing when `OnlySection` names another one. The element is built, but React never renders its children. */
function Only({ id, children }: { id: string; children: ReactNode }) {
  const only = useContext(OnlySection);
  return only === undefined || only === id ? <>{children}</> : null;
}

/** The id for a section, so a link such as `/gallery/#trace` reaches it. */
function useAnchor(): (title: string) => string {
  const prefix = useContext(AnchorPrefix);
  return (title) => prefix + slug(title);
}

const PLAN_DEMO_STEPS = [
  { text: "Add with_retry to the fetcher", files: ["src/fetch.py"] },
  { text: "Add fetch_retries to settings", files: ["src/config.py"] },
  { text: "Test three failures then success", files: ["tests/test_fetch.py"] },
];

/** The type tokens of tokens.css, each with a line to read it by. Class names are written out for Tailwind. */
const TYPE_SCALE = [
  ["title", "Settings", "text-title"],
  ["heading", "Model providers", "text-heading"],
  ["label", "Default model", "text-label"],
  ["body", "Golem picks a model for each helper.", "text-body"],
  ["meta", "Used by 3 sessions", "text-meta"],
  ["code", "claude-sonnet-5-5", "font-mono text-code"],
] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor(title)}>
      <h3 className="mb-2 font-mono text-xs text-faint">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

const galleryHistory = createHistory(() => null);

/** A composer with its draft in the component, so the gallery needs no page. */
const GALLERY_COMMANDS = withSkillChoices(
  withModelChoices(COMMANDS, ["local", "ollama/qwen3:8b", "ollama/gemma4:e4b"]),
  [
    { name: "review", description: "Reviews the diff.", argumentHint: "[path]" },
    { name: "commit-message", description: "Writes a commit message.", argumentHint: null },
  ],
  { pinnable: ["review", "commit-message"], active: ["review"] },
);

function DemoComposer({
  size,
  busy = false,
  disabledReason = null,
  initial = "",
  commands,
  withNotes = false,
  barLeft,
  barRight,
  strip,
}: {
  barLeft?: ReactNode;
  barRight?: ReactNode;
  strip?: ReactNode;
  size?: "dock" | "large";
  busy?: boolean;
  disabledReason?: string | null;
  /** The draft to start with. A slash draft opens the suggestions when `commands` is set. */
  initial?: string;
  commands?: typeof GALLERY_COMMANDS;
  /** Review notes wait: the send button says so. */
  withNotes?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [pastes, setPastes] = useState(noPastes);
  return (
    <Composer
      size={size}
      text={text}
      onTextChange={setText}
      pastes={pastes}
      onPastesChange={setPastes}
      history={galleryHistory}
      onSend={async () => undefined}
      sendLabel={withNotes ? "Send with notes" : "Send"}
      allowEmpty={withNotes}
      commands={commands}
      busy={busy}
      onStop={() => {}}
      disabledReason={disabledReason}
      barLeft={barLeft}
      barRight={barRight}
      strip={strip}
    />
  );
}

/** The composer's row as a session shows it, in a box of a fixed width: the row's steps depend on that width. */
function ComposerRowDemo({ width }: { width: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div aria-label={`Composer row, ${width} px`} role="group" style={{ width }} className="max-w-full">
      <DemoComposer
        strip={width === 720 ? <NotesChipView label="2 notes" onOpen={() => {}} onRemoveAll={() => {}} /> : undefined}
        barLeft={
          <>
            <ModelBarChipView
              name="qwen3.8:27b"
              route="auto"
              tuned="temp 0.2"
              title="qwen3.8:27b · local · ollama"
              label="Model: qwen3.8:27b, route auto, options changed"
              open={open}
              onOpenChange={setOpen}
              panel={<RoutePanelView mode="auto" ladder={[]} spend={[]} onSelect={() => {}} onNavigate={() => {}} />}
              onChoose={() => setOpen(false)}
              onTune={() => setOpen(false)}
            />
            <FolderBarBadge folder="/Users/you/repos/golem" />
            <BranchChipView mode="session" folder="/Users/you/repos/golem" shown="main" current="main" changed={0} branches={["main", "fix-x"]} onPick={() => {}} onCreate={() => {}} />
          </>
        }
        barRight={
          <>
            <ContextChipView used={38000} window={128000} onOpen={() => {}} />
            <ModeChipView own="balanced" fallback="careful" onSelect={() => {}} onPlan={() => {}} />
          </>
        }
      />
    </div>
  );
}

/** Every diff in both layouts, and the switch on its own. */
function DiffDemo() {
  const anchor = useAnchor();
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const samples = [
    ["An edit with two hunks", SAMPLE_EDIT_DIFF],
    ["A new file", SAMPLE_NEW_FILE_DIFF],
    ["A long line", SAMPLE_LONG_LINE_DIFF],
  ] as const;
  return (
    <section className="mt-6" id={anchor("Diff")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Diff</h3>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <p className="text-xs text-muted">With the switch</p>
            <DiffModeSwitch mode={mode} onChange={setMode} />
          </div>
          <DiffView diff={SAMPLE_EDIT_DIFF} mode={mode} />
        </div>
        <NotesDiffDemo />
        {samples.flatMap(([title, diff]) =>
          (["unified", "split"] as const).map((layout) => (
            <div key={`${title}-${layout}`}>
              <p className="mb-1 text-xs text-muted">{`${title}, ${layout}`}</p>
              <DiffView diff={diff} mode={layout} />
            </div>
          )),
        )}
      </div>
    </section>
  );
}

/** A diff that takes notes: one saved, and the box for a second one open. */
function NotesDiffDemo() {
  const [notes, setNotes] = useState<ReviewNote[]>([
    { id: "n1", path: "src/socket.ts", line: 4, side: "new", code: "export function connect(url: string) {", text: "Should this retry on a failed connect?" },
  ]);
  return (
    <div>
      <p className="mb-1 text-xs text-muted">With review notes</p>
      <DiffView
        diff={SAMPLE_EDIT_DIFF}
        mode="unified"
        notes={{
          notes,
          onAddNote: (line, text) => {
            setNotes((all) => [...all, { ...line, text, id: `n${all.length + 1}` }]);
          },
          onEditNote: (id, text) => {
            setNotes((all) => all.map((note) => (note.id === id ? { ...note, text } : note)));
          },
          onRemoveNote: (id) => {
            setNotes((all) => all.filter((note) => note.id !== id));
          },
        }}
      />
    </div>
  );
}

const SAMPLE_TODOS: TodoItem[] = [
  { id: "1", text: "Find where socket chunks are decoded", status: "done" },
  { id: "2", text: "Write a test that splits \u00e9 across two chunks", status: "done" },
  { id: "3", text: "Decode with a streaming TextDecoder", status: "in_progress" },
  { id: "4", text: "Run the client tests", status: "pending" },
];

const LONG_TODO: TodoItem[] = [
  {
    id: "1",
    text: "Rewrite packages/client/src/connection/reconnect-with-backoff-and-jitter.ts so that the delay never exceeds thirty seconds, whatever the attempt count",
    status: "in_progress",
  },
];

/** The todo list in its states. */
function TodoListDemo() {
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Todo list")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Todo list</h3>
      <div className="flex flex-wrap items-start gap-4">
        {(
          [
            ["Four steps", SAMPLE_TODOS],
            ["Empty", []],
            ["A long item", LONG_TODO],
          ] as const
        ).map(([title, todos]) => (
          <div key={title} className="flex w-80 flex-col gap-4 rounded-lg border border-line bg-surface p-4">
            <p className="text-xs text-muted">{title}</p>
            <TodoList todos={todos} />
          </div>
        ))}
      </div>
    </section>
  );
}

const DEMO_TABS: readonly WorkbenchTab[] = [
  { id: "todos", label: "Todos", badge: "2/5", render: () => <TodoList todos={SAMPLE_TODOS} /> },
  { id: "notes", label: "Notes", render: () => <p className="text-sm text-muted">Nothing here yet.</p> },
];

/** The tabbed panel at a fixed height. Its left edge is the resize handle. */
function WorkbenchDemo() {
  const anchor = useAnchor();
  const id = useId();
  return (
    <section className="mt-6" id={anchor("Workbench")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Workbench</h3>
      <div className="flex h-96 max-w-full justify-end overflow-hidden rounded-lg border border-line">
        <Workbench id={id} tabs={DEMO_TABS} floating={false} onClose={() => {}} />
      </div>
    </section>
  );
}

/** The batch card in the transcript: local only at three levels, cloud only at Normal, and a helper that asks. */
function BatchCardDemo() {
  const anchor = useAnchor();
  const cases = [
    ["local only, quiet", localBatchChat(), ALL_LOCAL, "quiet"],
    ["local only, normal", localBatchChat(), ALL_LOCAL, "normal"],
    ["local only, verbose", localBatchChat(), ALL_LOCAL, "verbose"],
    ["cloud only, normal", cloudBatchChat(), ALL_CLOUD, "normal"],
    ["one helper asking, normal", askingBatchChat(), ALL_LOCAL, "normal"],
  ] as const;
  return (
    <section className="mt-6" id={anchor("Batch card")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Batch card</h3>
      <div className="flex flex-col gap-3">
        {cases.map(([title, chat, isLocal, detail]) => (
          <div key={title} aria-label={`Batch card, ${title}`} role="group" className="flex flex-col gap-4 rounded-lg border border-line bg-bg p-4">
            <p className="font-mono text-xs text-faint">{title}</p>
            <TranscriptMessages chat={chat} detail={detail} isLocal={isLocal} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Inspector's Steps tab: a finished and a running batch, on local models (turns, hatched waits) and on cloud models (overlap). */
function StepsTabDemo() {
  const anchor = useAnchor();
  const cases = [
    ["local only, finished", localFinishedChat()],
    ["local only, running", localRunningChat()],
    ["cloud only, finished", cloudFinishedChat()],
    ["cloud only, running", cloudRunningChat()],
  ] as const;
  return (
    <section className="mt-6" id={anchor("Steps tab")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Steps tab</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {cases.map(([title, chat]) => (
          <div key={title} aria-label={`Steps tab, ${title}`} role="group" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <p className="font-mono text-xs text-faint">{title}</p>
            <StepsView batches={stepsBatches(chat, STEPS_NOW)} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Runs in the rail: a lead's row with its helper count over the full-width step list. */
function LeadRunDemo() {
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Runs, helpers")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Runs, helpers</h3>
      <div className="flex max-w-4xl flex-col gap-3">
        <LeadRun title="Fix the login redirect" model="Qwen3 Coder" running={1} waiting={1} batches={stepsBatches(localRunningChat(), STEPS_NOW)} href="/s/lead" onNavigate={() => {}} />
        <LeadRun title="Map the auth code" model="Claude Sonnet" running={0} waiting={0} batches={stepsBatches(cloudFinishedChat(), STEPS_NOW)} href="/s/lead" onNavigate={() => {}} />
      </div>
    </section>
  );
}

/** The helper panel beside a chat: one that runs, one that asks, one that is done and shows everything. */
function HelperPanelDemo() {
  const anchor = useAnchor();
  const [views, setViews] = useState<Record<string, HelperView>>({ running: "summary", asking: "summary", done: "everything" });
  const cases = [
    ["running", RUNNING_HELPER, null],
    ["asking", ASKING_HELPER, <ApprovalBar key="a" tool={PENDING_EDIT} onAnswer={() => {}} />],
    ["done", DONE_HELPER, null],
    ["trimmed", TRIMMED_HELPER, null],
  ] as const;
  return (
    <section className="mt-6" id={anchor("Helper panel")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Helper panel</h3>
      <div className="flex flex-wrap items-start gap-4">
        {cases.map(([key, sample, answer]) => (
          <div key={key} className="flex h-128 w-80 flex-col overflow-hidden rounded-lg border border-line bg-surface">
            <HelperPanelView
              lead="Fix the token refresh"
              helper={sample.helper}
              chat={sample.chat}
              nowMs={HELPER_NOW}
              view={views[key] ?? "summary"}
              onView={(view) => {
                setViews((current) => ({ ...current, [key]: view }));
              }}
              onClose={() => {}}
              onNext={key === "done" || key === "trimmed" ? null : () => {}}
              onStop={key === "done" || key === "trimmed" ? null : () => {}}
              onOpenChat={() => {}}
              answer={answer}
              trimmedAt={key === "trimmed" ? TRIMMED_AT : null}
              onContinue={key === "done" ? { onContinue: () => {}, busy: false, error: null } : null}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/** A helper's own chat: the banner of one that runs and one that is done, and the receipt of a trimmed one. */
function HelperBannerDemo() {
  const anchor = useAnchor();
  const lead = "Fix the token refresh";
  const running = helperBanner({ lead, ref: RUNNING_HELPER.helper, chat: RUNNING_HELPER.chat });
  const finished = helperBanner({ lead, ref: DONE_HELPER.helper, chat: DONE_HELPER.chat });
  const receipt = helperReceipt({ ref: TRIMMED_HELPER.helper, chat: TRIMMED_HELPER.chat, trimmedAt: TRIMMED_AT });
  return (
    <section className="mt-6" id={anchor("Helper banner, receipt")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Helper banner, receipt</h3>
      <div className="flex max-w-3xl flex-col gap-4">
        {(
          [
            ["running", running, () => {}, null],
            ["finished", finished, null, { onContinue: () => {}, busy: false, error: null }],
            ["refused", finished, null, { onContinue: () => {}, busy: false, error: "This helper's steps were removed, so it cannot be continued." }],
          ] as const
        ).map(([key, banner, onStop, onContinue]) => (
          <div key={key} className="overflow-hidden rounded-lg border border-line bg-surface">
            <HelperBannerBar banner={banner} leadId="lead" onBack={() => {}} onStop={onStop} onContinue={onContinue} />
          </div>
        ))}
        <HelperReceiptCard receipt={receipt} lead={{ id: "lead", onOpen: () => {} }} />
      </div>
    </section>
  );
}

const SAMPLE_CHANGES: ChangedFile[] = [
  { path: "src/socket.ts", status: "modified", added: 3, removed: 3, change_ids: ["c_1"], stale: false },
  { path: "src/utils/clamp.ts", status: "created", added: 3, removed: 0, change_ids: ["c_2"], stale: false },
  { path: "docs/old-notes.md", status: "deleted", added: 0, removed: 12, change_ids: ["c_3"], stale: true },
];

/** The Changes tab's list with three files, the first open, in a narrow and a wide panel. */
function ChangesDemo() {
  const anchor = useAnchor();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(["src/socket.ts"]));
  const [mode, setMode] = useState<"unified" | "split">("split");
  return (
    <section className="mt-6" id={anchor("Changes tab")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Changes tab</h3>
      <div className="flex flex-wrap items-start gap-4">
        {(
          [
            ["Narrow panel", false],
            ["Wide panel", true],
          ] as const
        ).map(([title, canSplit]) => (
          <div key={title} className={canSplit ? "flex w-full max-w-4xl flex-col gap-3" : "flex w-80 flex-col gap-3"}>
            <p className="text-xs text-muted">{title}</p>
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
              <ChangesView
                files={SAMPLE_CHANGES}
                error={null}
                open={open}
                onToggle={(path) => {
                  const next = new Set(open);
                  if (!next.delete(path)) next.add(path);
                  setOpen(next);
                }}
                undo={{ disabled: false, onFile: () => {} }}
                renderDiff={() => (
                  <DiffPanel
                    diff={{ diff: SAMPLE_EDIT_DIFF, truncated: true, error: null }}
                    mode={mode}
                    onMode={setMode}
                    canSplit={canSplit}
                    onHunkAction={(index) => (
                      <Button size="sm" aria-label={`Undo hunk ${index + 1} of src/socket.ts`}>
                        Undo
                      </Button>
                    )}
                  />
                )}
              />
            </div>
          </div>
        ))}
        <div className="flex w-80 flex-col gap-3">
          <p className="text-xs text-muted">Empty</p>
          <div className="rounded-lg border border-line bg-surface p-4">
            <ChangesView files={[]} error={null} open={new Set()} onToggle={() => {}} renderDiff={() => null} />
          </div>
        </div>
      </div>
    </section>
  );
}

const SAMPLE_NOW = Date.now();

const SAMPLE_CARDS: TurnCard[] = [
  {
    runId: "r3",
    number: 3,
    title: "make the wait configurable",
    at: new Date(SAMPLE_NOW - 120_000).toISOString(),
    files: [
      { path: "src/fetch.py", status: "modified", added: 5, removed: 2, changeIds: ["c_5"] },
      { path: "src/config.py", status: "modified", added: 4, removed: 1, changeIds: ["c_6"] },
    ],
    line: "2 files +9 −3",
    reverted: false,
    revertIds: [],
  },
  {
    runId: "r2",
    number: 2,
    title: "also log each retry",
    at: new Date(SAMPLE_NOW - 540_000).toISOString(),
    files: [{ path: "src/fetch.py", status: "modified", added: 4, removed: 0, changeIds: ["c_4"] }],
    line: "1 file +4",
    reverted: true,
    revertIds: ["u_1"],
  },
];

/** The Changes tab grouped by turn: a newest card with its file open, and an undone one. */
function TurnsDemo() {
  const anchor = useAnchor();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([rowKey({ runId: "r3", path: "src/fetch.py" })]));
  return (
    <section className="mt-6" id={anchor("Changes by turn")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Changes by turn</h3>
      <div className="flex w-80 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <TurnsView
          cards={SAMPLE_CARDS}
          open={open}
          onToggle={(row) => {
            const key = rowKey(row);
            const next = new Set(open);
            if (!next.delete(key)) next.add(key);
            setOpen(next);
          }}
          renderDiff={() => (
            <DiffPanel diff={{ diff: SAMPLE_EDIT_DIFF, truncated: false, error: null }} mode="unified" onMode={() => {}} canSplit={false} />
          )}
          now={SAMPLE_NOW}
          undo={{ disabled: false, onRewind: () => {}, onRedo: () => {} }}
        />
      </div>
    </section>
  );
}

const SAMPLE_FILE = `import { clamp } from "./utils/clamp";

/** Keeps a retry delay inside its bounds. */
export function delay(attempt: number): number {
  return clamp(100 * 2 ** attempt, 100, 5000);
}
`;

/** The Files tab: its list with the change set first, a short file, and a file that failed to open. */
function FilesDemo() {
  const anchor = useAnchor();
  const [typed, setTyped] = useState("");
  const [hiddenFiles, setHiddenFiles] = useState(false);
  const none = { file: null, error: null };
  return (
    <section className="mt-6" id={anchor("Files tab")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Files tab</h3>
      <div className="flex flex-wrap items-start gap-4">
        {(
          [
            ["List", null, none],
            ["A file", "src/fetch.ts", { file: { path: "src/fetch.ts", text: SAMPLE_FILE, truncated: true, lines: 7 }, error: null }],
            ["A file that cannot be shown", "logo.png", { file: null, error: "logo.png looks like a binary file" }],
          ] as const
        ).map(([title, open, file]) => (
          <div key={title} className="flex w-80 flex-col gap-3">
            <p className="text-xs text-muted">{title}</p>
            <div className="flex h-96 flex-col rounded-lg border border-line bg-surface p-4">
              <FilesView
                typed={typed}
                onTyped={setTyped}
                hidden={hiddenFiles}
                onHidden={setHiddenFiles}
                changed={["src/socket.ts", "src/utils/clamp.ts"]}
                found={["src/fetch.ts", "src/socket.ts", "src/utils/clamp.ts", "docs/notes.md"]}
                more={false}
                listError={null}
                open={open}
                file={file}
                line={null}
                onOpen={() => {}}
                onBack={() => {}}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const SAMPLE_CHECK_RUNS: CheckRun[] = [
  { checkId: "k1", name: "ruff", command: "ruff check .", round: 0, status: "failed", exitCode: 1, durationMs: 800, output: "src/socket.ts:12:5: F401 `os` imported but unused\nFound 1 error.", artifactId: null },
  { checkId: "k2", name: "ruff", command: "ruff check .", round: 1, status: "passed", exitCode: 0, durationMs: 700, output: "All checks passed!", artifactId: null },
  { checkId: "k3", name: "tsc", command: "pnpm run typecheck", round: 1, status: "passed", exitCode: 0, durationMs: 5500, output: "", artifactId: null },
];
const SAMPLE_CHECKS: ChecksState = {
  turns: [
    { runId: "r_old", runs: [{ ...SAMPLE_CHECK_RUNS[0]!, checkId: "k0", round: 0 }] },
    { runId: "r_new", runs: SAMPLE_CHECK_RUNS },
  ],
  offered: null,
  allowed: true,
};

/** The line under a turn, in each tone. */
function ChecksStripDemo() {
  const anchor = useAnchor();
  const cases: { label: string; turn: TurnChecks; running: boolean }[] = [
    { label: "Running", turn: { runId: "r", runs: [{ ...SAMPLE_CHECK_RUNS[1]!, checkId: "a", round: 0 }, { ...SAMPLE_CHECK_RUNS[2]!, checkId: "b", round: 0, status: "running", durationMs: null }] }, running: true },
    { label: "Passed", turn: { runId: "r", runs: SAMPLE_CHECK_RUNS.slice(1) }, running: false },
    { label: "Failed, being fixed", turn: { runId: "r", runs: SAMPLE_CHECK_RUNS.slice(0, 1) }, running: true },
    { label: "Failed for good", turn: { runId: "r", runs: SAMPLE_CHECK_RUNS.slice(0, 1) }, running: false },
  ];
  return (
    <section className="mt-6" id={anchor("Checks strip")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Checks strip</h3>
      <div className="flex max-w-xl flex-col gap-3">
        {cases.map(({ label, turn, running }) => (
          <div key={label}>
            <p className="mb-1 text-xs text-muted">{label}</p>
            <ChecksStrip {...checksSummary(turn, running)} onShow={() => {}} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Checks tab: the newest turn failed once and then passed, an older turn failed, and one output is cut. */
function ChecksTabDemo() {
  const anchor = useAnchor();
  const [allowed, setAllowed] = useState<boolean | null>(true);
  const cut: ChecksState = {
    ...SAMPLE_CHECKS,
    allowed,
    turns: [SAMPLE_CHECKS.turns[0]!, { runId: "r_new", runs: [{ ...SAMPLE_CHECK_RUNS[0]!, checkId: "k9", artifactId: "a_1" }] }],
  };
  return (
    <section className="mt-6" id={anchor("Checks tab")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Checks tab</h3>
      <div className="flex flex-wrap items-start gap-4">
        {([["Passed after a fix", { ...SAMPLE_CHECKS, allowed }], ["Failed, output cut", cut], ["Nothing yet", { turns: [], offered: null, allowed }]] as [string, ChecksState][]).map(([title, checks]) => (
          <div key={title} className="flex w-80 flex-col gap-3">
            <p className="text-xs text-muted">{title}</p>
            <div className="rounded-lg border border-line bg-surface p-4">
              <ChecksView checks={checks} running={null} error={null} onAllow={setAllowed} readAll={() => <p className="text-xs text-muted">The whole output.</p>} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The question above the composer. */
function ChecksQuestionDemo() {
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Checks question")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Checks question</h3>
      <div className="max-w-xl rounded-lg border border-line bg-bg p-4">
        <DockView
          busy={false}
          meter={<Meter state="idle" runStartedAt={null} />}
          question={<ChecksQuestionView offered={[{ name: "ruff", command: "ruff check ." }, { name: "tsc", command: "pnpm run typecheck" }]} onAnswer={() => {}} />}
          composer={<DemoComposer />}
        />
      </div>
    </section>
  );
}

const UNDO_CHAT: Pick<ChatState, "messages" | "error" | "notice"> = {
  messages: [
    { id: "uu1", role: "user", text: "Clamp the retry delay.", streaming: false, runId: "run-1" },
    { id: "us1", role: "assistant", text: "Done: the delay is clamped.", streaming: false, runId: "run-1", tools: [{ callId: "ue1", name: "edit_file", args: { path: "src/socket.ts" }, status: "done", summary: "+3 -3 src/socket.ts", diff: SAMPLE_EDIT_DIFF }] },
    { id: "uu2", role: "user", text: "Add a clamp helper.", streaming: false, runId: "run-2" },
    { id: "us2", role: "assistant", text: "Added `clamp.ts`.", streaming: false, runId: "run-2", tools: [{ callId: "ue2", name: "write_file", args: { path: "src/clamp.ts" }, status: "done", summary: "new file +4 -0 src/clamp.ts", diff: SAMPLE_NEW_FILE_DIFF }] },
  ] satisfies ChatMessage[],
  error: null,
  notice: null,
};

const UNDO_STATE: TurnUndo = {
  turns: { "run-1": { files: 2, reverted: true }, "run-2": { files: 1, reverted: false } },
  latest: "run-2",
  disabled: false,
  onUndo: () => {},
  onRedo: () => {},
};

const UNDO_PLAN: RewindPlan = {
  turns: [
    { runId: "run-2", number: 2, title: "Add a clamp helper.", at: null, files: [], line: "", reverted: false, revertIds: [] },
    { runId: "run-1", number: 1, title: "Clamp the retry delay.", at: null, files: [], line: "", reverted: false, revertIds: [] },
  ],
  paths: ["src/socket.ts", "src/clamp.ts"],
};

/** The two undo dialogs: a rewind of two turns, and the files that changed since golem wrote them. Each opens from a button. */
function UndoDialogsDemo({ theme }: { theme: string }) {
  const [shown, setShown] = useState<"rewind" | "conflicts" | null>(null);
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Undo dialogs")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Undo dialogs</h3>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["rewind", "Rewind dialog"],
            ["conflicts", "Conflict dialog"],
          ] as const
        ).map(([kind, label]) => (
          <Button key={kind} onClick={() => setShown(kind)}>
            {label}
            <span className="sr-only">, {theme}</span>
          </Button>
        ))}
      </div>
      <RewindDialogView open={shown === "rewind"} onOpenChange={(open) => setShown(open ? shown : null)} plan={UNDO_PLAN} working={false} onConfirm={() => setShown(null)} />
      <ConflictDialogView
        open={shown === "conflicts"}
        onOpenChange={(open) => setShown(open ? shown : null)}
        paths={["src/socket.ts", "docs/notes.md"]}
        working={false}
        onOverwrite={() => setShown(null)}
        onKeep={() => setShown(null)}
      />
    </section>
  );
}

const COMMIT_PATHS = ["src/socket.ts", "src/clamp.ts", "docs/old-notes.md"];

/** The commit dialog: a ready one, and one where git refused. Each opens from a button. */
function CommitDialogDemo({ theme }: { theme: string }) {
  const [shown, setShown] = useState<"ready" | "refused" | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(COMMIT_PATHS));
  const [message, setMessage] = useState("Clamp the socket read size\n\nA read past the buffer no longer splits a UTF-8 character.");
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Commit dialog")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Commit dialog</h3>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["ready", "Commit dialog"],
            ["refused", "Commit refused"],
          ] as const
        ).map(([kind, label]) => (
          <Button key={kind} onClick={() => setShown(kind)}>
            {label}
            <span className="sr-only">, {theme}</span>
          </Button>
        ))}
      </div>
      <CommitDialogView
        open={shown !== null}
        onOpenChange={(open) => setShown(open ? shown : null)}
        branch="main"
        paths={COMMIT_PATHS}
        chosen={chosen}
        onToggle={(path) =>
          setChosen((current) => {
            const next = new Set(current);
            if (!next.delete(path)) next.add(path);
            return next;
          })
        }
        message={message}
        onMessage={setMessage}
        suggesting={false}
        suggestNote={null}
        onSuggestAgain={() => {}}
        runActive={false}
        committing={false}
        onCommit={() => setShown("refused")}
        failure={shown === "refused" ? "[main 0000000] hook failed\nlint: src/socket.ts:12 unused variable\nCommit stopped by the pre-commit hook." : null}
        error={null}
      />
    </section>
  );
}

/** A pending bar whose editor is open, and closes on Cancel. */
function EditingDemo({ draft }: { draft?: string }) {
  const [editing, setEditing] = useState(true);
  return <ApprovalBar tool={PENDING_SHELL} editing={editing} draft={draft} onEdit={setEditing} onAnswer={() => {}} />;
}

/** The approval docked above the composer, as a session shows it. */
function DockedApprovalDemo({ tool, label }: { tool: typeof PENDING_EDIT; label: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="rounded-lg border border-line bg-bg p-4">
        <DockView
          busy
          meter={<Meter state="waiting" runStartedAt={null} />}
          approval={<ApprovalBar tool={tool} onAnswer={() => {}} />}
          composer={<DemoComposer busy />}
        />
      </div>
    </div>
  );
}

/** The dock when helpers ask: the counter over a helper's question, and a helper's paid question. */
function HelperDockDemo() {
  const [index, setIndex] = useState(0);
  const items = SAMPLE_HELPER_INBOX;
  const current = items[index];
  const demo = (label: string, node: ReactNode) => (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="rounded-lg border border-line bg-bg p-4">
        <DockView busy meter={<Meter state="waiting" runStartedAt={null} />} approval={node} composer={<DemoComposer busy />} />
      </div>
    </div>
  );
  return (
    <>
      {demo(
        "Docked above the lead's composer, a helper's command: 1 of 2, and the second is asked by five helpers",
        <>
          <DockCounter index={index} total={items.length} onPick={setIndex} />
          {current === undefined ? null : <HelperQuestion item={current} onAnswer={() => {}} onOpen={() => {}} />}
        </>,
      )}
      {demo(
        "A helper's paid question: what is sent and not sent",
        <ConsentBar
          consent={{
            runId: "r1",
            modelProfile: "deepseek/deepseek-chat",
            model: "deepseek-chat",
            tier: "budget",
            why: "The brief needs a model with a bigger window.",
            estimatedUsd: 0.0213,
            alternatives: ["once", "local"],
            caps: null,
            signal: null,
            helper: SAMPLE_HELPER_CONSENT.helper?.name ?? null,
            sent: SAMPLE_HELPER_CONSENT.sent,
            notSent: SAMPLE_HELPER_CONSENT.notSent,
          }}
          onAnswer={() => {}}
        />,
      )}
    </>
  );
}

/** The approval bar, waiting in the dock, and the chips it leaves in the steps. */
function ApprovalDemo() {
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Approval")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Approval</h3>
      <div className="flex flex-col gap-4">
        <HelperDockDemo />
        <DockedApprovalDemo label="Docked above the composer, an edit: the diff is open" tool={PENDING_EDIT} />
        <DockedApprovalDemo label="Docked above the composer, a command: Details is closed" tool={PENDING_SHELL} />
        <div className="max-w-sm">
          <DockedApprovalDemo label="Docked at phone width: the buttons wrap" tool={PENDING_SHELL} />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Editing the arguments</p>
          <EditingDemo />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Editing the arguments, not valid JSON</p>
          <EditingDemo draft={'{\n  "command": "pnpm test",\n'} />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Chips in the steps, one for each way a question ends</p>
          <ul aria-label="Answered approvals" className="flex list-none flex-col gap-0.5 border-l border-line py-0.5 pl-3 font-mono text-xs leading-snug">
            {ANSWERED.map(({ label, tool }) => (
              <ToolLine key={label} tool={tool} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SessionActionsDemo({ theme }: { theme: string }) {
  const [closing, setClosing] = useState(false);
  return (
    <div className="grid gap-4 rounded-lg border border-line bg-bg p-4">
      <div className="flex items-center rounded-md border border-line px-4 py-2.5">
        <SessionTitle
          title="UTF-8 split in the socket client"
          canFork
          headingLevel="h4"
          actions={{ rename: () => Promise.resolve(), fork: () => Promise.resolve(), close: () => Promise.resolve() }}
        />
      </div>
      <div className="flex items-center rounded-md border border-line px-4 py-2.5">
        <SessionTitle
          title={null}
          canFork={false}
          headingLevel="h4"
          actions={{ rename: () => Promise.resolve(), fork: () => Promise.resolve(), close: () => Promise.resolve() }}
        />
      </div>
      <div className="flex items-center gap-2 rounded-md border border-line px-4 py-2.5">
        <RenameField
          initial="UTF-8 split in the socket client"
          label={`Session title, ${theme}`}
          onSave={() => Promise.reject(new Error("session not found"))}
          onEnd={() => {}}
        />
      </div>
      <div>
        <Button onClick={() => setClosing(true)}>Close dialog</Button>
        <CloseSessionDialog open={closing} onOpenChange={setClosing} onConfirm={() => Promise.resolve()} />
      </div>
    </div>
  );
}

const MODEL_CASES: { label: string; props: Partial<ModelDialogViewProps> }[] = [
  { label: "The list", props: {} },
  { label: "Starred models", props: { listing: STARRED_LISTING, onShowAll: () => {} } },
  { label: "Show all, with stars", props: { listing: STARRED_LISTING, showAll: true, onShowAll: () => {} } },
  { label: "Nothing starred", props: { listing: UNSTARRED_LISTING, onShowAll: () => {} } },
  { label: "New session", props: { mode: "new", session: null } },
  { label: "New session, a pick", props: { mode: "new", session: { profile: "ollama/qwen3:8b", name: null }, initial: { activeId: "ollama/qwen3:8b" } } },
  { label: "New session, not ready", props: { mode: "new", session: null, initial: { activeId: "ollama/qwen3:14b" } } },
  { label: "Download question", props: { initial: { activeId: "ollama/qwen3:14b", confirm: { kind: "pull", ref: "ollama/qwen3:14b", step: 1 } } } },
  { label: "Too big, first question", props: { initial: { activeId: "ollama/qwen3:32b", confirm: { kind: "pull", ref: "ollama/qwen3:32b", step: 1 } } } },
  { label: "Too big, second question", props: { initial: { activeId: "ollama/qwen3:32b", confirm: { kind: "pull", ref: "ollama/qwen3:32b", step: 2 } } } },
  { label: "Remove question", props: { initial: { activeId: "ollama/gemma4:e4b", confirm: { kind: "remove", ref: "ollama/gemma4:e4b" } } } },
  { label: "Download in progress", props: { initial: { activeId: "ollama/gemma3:12b" } } },
  { label: "A refused action", props: { initial: { activeId: "ollama/gemma4:e4b", failure: "model not found" } } },
  { label: "Ollama down", props: { listing: OLLAMA_DOWN_LISTING } },
  { label: "No Ollama", props: { listing: NO_OLLAMA_LISTING } },
  { label: "Tune view", props: { initial: { tune: "ollama/qwen3:8b" } } },
  { label: "Tune view, a model that is not the session's", props: { initial: { tune: "ollama/gemma4:e4b" } } },
  { label: "Tune view, try again", props: { initial: { tune: "ollama/qwen3:8b" }, tune: { ...sampleTuneBackend(), again: sampleTry("idle") } } },
  { label: "Tune view, no question to try", props: { initial: { tune: "ollama/qwen3:8b" }, tune: { ...sampleTuneBackend(), again: sampleTry("no-question") } } },
  { label: "Tune view, chat running", props: { initial: { tune: "ollama/qwen3:8b" }, tune: { ...sampleTuneBackend(), again: sampleTry("running") } } },
  { label: "Tune view, a try streaming", props: { initial: { tune: "ollama/qwen3:8b" }, tune: { ...sampleTuneBackend(), again: sampleTry("streaming") } } },
  { label: "Tune view, a try done", props: { initial: { tune: "ollama/qwen3:8b" }, tune: { ...sampleTuneBackend(), again: sampleTry("done") } } },
  { label: "Tune view, a thinking model", props: { listing: THINKING_LISTING, initial: { tune: "ollama/qwen3.5:4b" }, tune: sampleTuneBackend() } },
  { label: "Tune view, thinking levels", props: { listing: THINKING_LISTING, initial: { tune: "ollama/gpt-oss:20b" }, tune: sampleTuneBackend() } },
  { label: "Tune view, a try failed", props: { initial: { tune: "ollama/qwen3:8b" }, tune: { ...sampleTuneBackend(), again: sampleTry("failed") } } },
  { label: "Loading", props: { listing: null } },
  { label: "Could not list", props: { listing: null, loadError: "daemon went away" } },
];

/** The Commands dialog, opened from a button. */
function CommandsDemo({ theme }: { theme: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>
        Commands
        <span className="sr-only">, {theme}</span>
      </Button>
      <CommandsDialog open={open} onOpenChange={setOpen} commands={COMMANDS} />
    </div>
  );
}

const PALETTE_CASES: { label: string; hasComposer: boolean; initialQuery: string }[] = [
  { label: "Palette, all commands", hasComposer: true, initialQuery: "" },
  { label: "Palette, filtered", hasComposer: true, initialQuery: "mo" },
  { label: "Palette, Send row", hasComposer: true, initialQuery: "explain this repo" },
  { label: "Palette, no composer", hasComposer: false, initialQuery: "" },
];

/** The command palette in each state it can start in, and the key list. */
function PaletteDemo({ theme }: { theme: string }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-bg p-4">
      {PALETTE_CASES.map(({ label, hasComposer, initialQuery }) => (
        <div key={label}>
          <Button onClick={() => setShown(label)}>
            {label}
            <span className="sr-only">, {theme}</span>
          </Button>
          <CommandPaletteView
            open={shown === label}
            onOpenChange={(open) => setShown(open ? label : null)}
            hasComposer={hasComposer}
            onPick={() => setShown(null)}
            initialQuery={initialQuery}
          />
        </div>
      ))}
      <div>
        <Button onClick={() => setShown("Keys")}>
          Key list
          <span className="sr-only">, {theme}</span>
        </Button>
        <KeysDialog open={shown === "Keys"} onOpenChange={(open) => setShown(open ? "Keys" : null)} />
      </div>
    </div>
  );
}

/** The model dialog in each state it can start in. */
function ModelDialogDemo({ theme }: { theme: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const none = () => Promise.resolve();
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-bg p-4">
      {MODEL_CASES.map(({ label, props }) => (
        <div key={label}>
          <Button onClick={() => setShown(label)}>
            {label}
            <span className="sr-only">, {theme}</span>
          </Button>
          <ModelDialogView
            open={shown === label}
            onOpenChange={(open) => setShown(open ? label : null)}
            session={{ profile: "local", name: "qwen3:8b" }}
            listing={SAMPLE_LISTING}
            loadError={null}
            onRetry={() => {}}
            pulls={SAMPLE_PULLS}
            tune={sampleTuneBackend()}
            actions={{ use: none, setDefault: none, star: none, pull: none, stop: none, remove: none, refresh: none }}
            {...props}
          />
        </div>
      ))}
    </div>
  );
}

const LIST_NOTES = new Map<string, ModelListNote>([
  ["ollama/qwen3:14b", { tag: "recommended", reason: "Strong at code, and it fits in 16 GB of memory.", estimate: "about 12 min" }],
  ["ollama/gemma3:12b", { estimate: "about 8 min" }],
]);

/** The list alone, as `/welcome` shows it: a leading group, a tag and a reason, a download, and a collapsed tail. */
function ModelListDemo() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listing = withActivePulls(SAMPLE_LISTING, SAMPLE_PULLS) ?? SAMPLE_LISTING;
  const fits = listing.models.filter((model) => model.source === "catalog" && model.fit === "fits");
  const groups = pickerGroups(listing, query, null);
  return (
    <div className="flex h-96 max-w-2xl flex-col rounded-lg border border-line bg-bg p-4">
      <ModelList
        className="min-h-0 flex-1"
        listClassName="flex-1"
        listing={listing}
        groups={groups}
        leading={{ title: "Fits this Mac · 16 GB memory", models: fits }}
        notes={LIST_NOTES}
        collapse={{ keep: 4 }}
        profile="local"
        category={null}
        pulls={SAMPLE_PULLS}
        query={query}
        onQueryChange={setQuery}
        activeId={activeId}
        onActiveChange={setActiveId}
        onActivate={() => {}}
        onStop={() => {}}
        onStar={() => {}}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">No matching models.</p>}
      />
    </div>
  );
}

const SAMPLE_ENTRY = [...SAMPLE_PULLS.active.values()][0]!;
const SAMPLE_LABELS = new Map([
  ["ollama/gemma3:12b", "Gemma 3 12B"],
  ["ollama/qwen3:14b", "Qwen3 14B"],
]);
const DOWNLOAD_ROWS = [
  { label: "One download", summary: pullSummary(SAMPLE_PULLS.active, new Map(), SAMPLE_LABELS) },
  {
    label: "Two downloads",
    summary: pullSummary(
      new Map([...SAMPLE_PULLS.active, ["ollama/qwen3:14b", { ...SAMPLE_ENTRY, track: { ...SAMPLE_ENTRY.track, completed: 900_000_000, total: 9_300_000_000 } }]]),
      new Map(),
      SAMPLE_LABELS,
    ),
  },
  { label: "Failed", summary: pullSummary(new Map(), SAMPLE_PULLS.failed, SAMPLE_LABELS) },
  { label: "Failed, Hugging Face", summary: pullSummary(new Map(), HF_FAILED.failed, SAMPLE_LABELS, HF_FAILED.extra) },
] as const;

const BROWSER_HOME = "/Users/you";
function browserListing(path: string, names: string[], truncated = false) {
  return {
    path,
    home: BROWSER_HOME,
    parent: path === BROWSER_HOME ? null : path.slice(0, path.lastIndexOf("/")),
    entries: names.map((name) => ({ name, path: `${path}/${name}`, git: name === "golem" || name === "notes-site" })),
    truncated,
  };
}
const BROWSER_CASES = [
  { label: "At home", listing: browserListing(BROWSER_HOME, ["Desktop", "Documents", "notes", "repos"]) },
  { label: "Deep in a tree", listing: browserListing(`${BROWSER_HOME}/repos/work/clients`, ["golem", "notes-site", "scratch"]) },
  { label: "Empty", listing: browserListing(`${BROWSER_HOME}/repos/empty`, []) },
  {
    label: "Truncated",
    listing: browserListing(BROWSER_HOME, Array.from({ length: 500 }, (_, index) => `project-${String(index).padStart(3, "0")}`), true),
  },
  { label: "Loading", listing: null, loading: true },
  { label: "Error", listing: null, error: "golem can't read /Users/you/repos/locked." },
] as const;

/** The folder browser in each state it can show. */
function FolderBrowserDemo({ theme }: { theme: string }) {
  const none = () => {};
  return (
    <div className="flex flex-wrap gap-4">
      {BROWSER_CASES.map((item) => (
        <div key={item.label} className="w-96 rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="mb-2 font-mono text-xs text-faint">{item.label}</p>
          <FolderBrowserView
            listing={item.listing}
            loading={"loading" in item}
            error={"error" in item ? item.error : null}
            query=""
            onQueryChange={none}
            onOpen={none}
            onUp={none}
            onGoTyped={none}
            onRetry={none}
            onPick={none}
            onCancel={none}
            autoFocus={false}
            navLabel={`Folder path, ${item.label}, ${theme}`}
          />
        </div>
      ))}
    </div>
  );
}

/** The sidebar's download row in each state it can show. */
function DownloadRowDemo() {
  return (
    <div className="flex flex-wrap gap-4">
      {DOWNLOAD_ROWS.map(({ label, summary }) => (
        <div key={label} className="flex w-sidebar flex-col gap-2 rounded-lg border border-line bg-sunken p-2.5">
          <span className="font-mono text-xs text-faint">{label}</span>
          <PullStatusView summary={summary} announcement="" onOpen={() => {}} onDismiss={() => {}} />
        </div>
      ))}
    </div>
  );
}

/** The Tools panel that `/welcome` and Settings → Setup share, in the states it draws. */
function ToolsOfferDemo() {
  return (
    <div className="flex flex-col gap-4">
      {TOOLS_CASES.map(({ label, state }) => (
        <section key={label} aria-label={label} className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label}</span>
          <div className="max-w-xl">
            <ToolsOfferView
              state={state}
              draft=""
              logs={{}}
              onDraft={() => {}}
              onTick={() => {}}
              onStart={() => {}}
              onSkip={() => {}}
              onContinue={() => {}}
              onRetry={() => {}}
              onSkipRow={() => {}}
              onLog={() => {}}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

const SIGN_IN_SERVER: McpServer = { name: "linear", state: "needs_auth", command: "https://mcp.linear.app/mcp", on_demand: false, enabled: null };

const SIGN_IN_CASES: { label: string; server: McpServer; login: Login | undefined }[] = [
  { label: "Needs sign-in", server: SIGN_IN_SERVER, login: undefined },
  { label: "Waiting for the sign-in", server: SIGN_IN_SERVER, login: { kind: "waiting", url: "https://auth.example/authorize" } },
  { label: "Signed in", server: { ...SIGN_IN_SERVER, state: "running", tools: ["mcp__linear__list_issues", "mcp__linear__get_issue"] }, login: { kind: "done", text: "Signed in to linear · 2 tools" } },
  { label: "Sign-in failed", server: SIGN_IN_SERVER, login: { kind: "failed", error: "the sign-in timed out" } },
];

/** A server that signs in: its row and its panel in each state of the sign-in. */
function McpSignInDemo() {
  return (
    <div className="flex flex-col gap-4">
      {SIGN_IN_CASES.map(({ label, server, login }) => (
        <section key={label} aria-label={`MCP sign-in, ${label}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label}</span>
          <div className="flex max-w-xl flex-col gap-0.5 rounded-lg border border-line-strong bg-surface px-3 py-2">
            <span className="flex items-center gap-x-2">
              <Dot server={server} />
              <span className="font-ui text-sm font-medium">{server.name}</span>
              <span className="font-mono text-xs text-faint">{mcpStatusWord(server)}</span>
            </span>
            <span className={login?.kind === "failed" ? "pl-4 font-mono text-xs text-deny" : "pl-4 font-mono text-xs text-muted"}>{serverSummary(server, false, login)}</span>
          </div>
          {server.state === "needs_auth" ? (
            <div className="max-w-xl">
              <SignInPanel name={server.name} login={login} onSignIn={() => {}} />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

const TOKEN_BASE = { oauth: false, state: "running" as const, secrets: [{ ref: "mcp/github", stored: true }], refused: false, workedAt: 0, now: 120_000 };
const TOKEN_LINES: { label: string; line: SignInLine | null }[] = [
  { label: "Token works", line: signInLine(TOKEN_BASE) },
  { label: "Token missing", line: signInLine({ ...TOKEN_BASE, secrets: [{ ref: "mcp/github", stored: false }] }) },
  { label: "Token refused", line: signInLine({ ...TOKEN_BASE, refused: true }) },
  { label: "Signed in", line: signInLine({ ...TOKEN_BASE, oauth: true }) },
  { label: "Not signed in", line: signInLine({ ...TOKEN_BASE, oauth: true, state: "needs_auth" }) },
];
const TOKEN_STEPS = [
  { step: "resolve", state: "ok" },
  { step: "connect", state: "ok" },
  { step: "initialize", state: "ok" },
  { step: "tools", state: "ok", detail: "46 tools" },
] as const;
const TOKEN_TESTS: { label: string; test: TokenTest }[] = [
  { label: "Testing", test: { phase: "running", steps: TOKEN_STEPS.slice(0, 2) } },
  { label: "Passed", test: { phase: "passed", steps: TOKEN_STEPS, message: "The new token works. It replaced the old one." } },
  {
    label: "Refused",
    test: {
      phase: "failed",
      steps: [TOKEN_STEPS[0], TOKEN_STEPS[1], { step: "initialize", state: "failed", detail: "HTTP 401: bad credentials" }],
      message: "The server refused this token. Your old token is still in use.",
      out: { config: {}, secrets: {} },
    },
  },
];

/** The sign-in line, the token in Edit as a pill and as a field, and the test before a token is kept. */
function McpTokenDemo() {
  const row = { key: "Authorization", value: "", secret: true, ref: "mcp/github", prefix: "Bearer " };
  const noop = (): void => {};
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {TOKEN_LINES.map(({ label, line }) =>
        line === null ? null : (
          <section key={label} aria-label={`MCP token, ${label}`} className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-4">
            <span className="font-mono text-xs text-faint">{label}</span>
            <TokenLine line={line} onAction={noop} canEdit waiting={false} />
          </section>
        ),
      )}
      <section aria-label="MCP token, In Edit" className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">In Edit</span>
        <StoredValue noun="header 1" row={row} there open={false} round={0} onType={noop} onOpen={noop} onClose={noop} />
        <StoredValue noun="header 2" row={row} there={false} open={false} round={0} onType={noop} onOpen={noop} onClose={noop} />
        <StoredValue noun="header 3" row={row} there open round={0} onType={noop} onOpen={noop} onClose={noop} />
      </section>
      {TOKEN_TESTS.map(({ label, test }) => (
        <section key={label} aria-label={`MCP token test, ${label}`} className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">Test: {label}</span>
          <TokenTestView test={test} host="api.githubcopilot.com" onTryAgain={noop} onKeep={noop} />
        </section>
      ))}
    </div>
  );
}

const SAMPLE_CHECKED_AT = Date.now();

/** Settings → Info: the hero card, the health list and the paths, in each state. */
function SetupFormDemo() {
  return (
    <div className="flex flex-col gap-4">
      {FORM_CASES.map(({ label, rows, actions, facts }) => (
        <section key={label} aria-label={`Setup, ${label}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label}</span>
          <HeroCard
            install={facts?.install}
            fallbackVersion="0.5.0"
            checkedAt={SAMPLE_CHECKED_AT}
            checking={false}
            busy={false}
            onRunAgain={() => {}}
            onCheckAgain={() => {}}
          />
          <SetupFormView
            rows={rows}
            actions={actions}
            onButton={() => {}}
            onCancelInstall={() => {}}
            onNavigate={() => {}}
            hasPage={() => false}
          />
          {facts === null ? null : <PathsGrid facts={facts} />}
        </section>
      ))}
    </div>
  );
}

/** Settings → MCP servers: the Catalog tab's cards, and the Import tab with nothing picked and with some picked. */
function SkillsDemo() {
  const broken = SAMPLE_SKILLS[3];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Skills, list" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">List</span>
        <SkillList skills={SAMPLE_SKILLS} wide selected={SAMPLE_SKILLS[1]?.path ?? null} register={() => {}} onNew={() => {}} onOpen={() => {}} />
      </section>
      <section aria-label="Skills, overview" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Overview of a broken skill</span>
        {broken === undefined ? null : <SkillOverview skill={broken} />}
      </section>
      <section aria-label="Skills, SKILL.md" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">SKILL.md with a problem on line 3</span>
        <CodeEditor value={SAMPLE_BROKEN_SKILL_MD} onChange={() => {}} marked={new Set([3])} label="broken-one SKILL.md" language="markdown" className="h-72" />
        <p role="alert" className="rounded-md border border-deny bg-deny-soft px-3 py-2 font-mono text-xs text-deny">
          line 3: expected &apos;,&apos; or &apos;]&apos;
        </p>
      </section>
    </div>
  );
}

/** The file actions of the agents gallery entries: they do nothing. */
const AGENT_FILES = {
  onSave: async () => ({ ok: true, problems: [] }),
  onCopy: async (name: string) => ({ name, description: "", origin: "user" as const, wish: "cheapest" }),
  onDelete: async () => ({ agent: null }),
};

/** Settings → Agents: the table with a bundled, a user and a project agent, a broken file and a blocked one; and an empty list. */
function AgentsDemo() {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Agents, wide" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Wide: list and detail, with a broken file and a project agent that is not trusted</span>
        <AgentsPage agents={SAMPLE_AGENTS} start="bundled/explorer" onSetWish={async () => {}} />
      </section>
      <section aria-label="Agents, narrow" className="flex max-w-md flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Narrow: one column, a row opened in place</span>
        <AgentsPage agents={SAMPLE_AGENTS} narrow start="bundled/reviewer" onSetWish={async () => {}} />
      </section>
      {(
        [
          ["Agents, editor", "Edit: the file of your own agent in a text box, with Save and Cancel", "user/triage", "edit"],
          ["Agents, refused save", "A refused save keeps the text and says Not saved, with the line and the problem", "user/triage", "refused"],
          ["Agents, delete question", "Delete asks once, in place", "user/triage", "delete"],
          ["Agents, new agent", "+ New agent: the template in the editor, and a row that is not saved yet", "bundled/explorer", "new"],
        ] as const
      ).map(([title, caption, start, demo]) => (
        <section key={title} aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{caption}</span>
          <AgentsPage agents={SAMPLE_AGENTS} start={start} demo={demo} onSetWish={async () => {}} {...AGENT_FILES} />
        </section>
      ))}
      <section aria-label="Agents, a copy" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">A copy of a bundled agent: yours, it replaces the bundled one, and delete says the bundled one comes back</span>
        <AgentsPage agents={[...SAMPLE_AGENTS.filter((agent) => agent.name !== "reviewer"), SAMPLE_COPY]} start="user/reviewer" demo="delete" onSetWish={async () => {}} {...AGENT_FILES} />
      </section>
      <section aria-label="Agents, narrow editor" className="flex max-w-md flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Narrow: the editor and a refused save inside the opened row</span>
        <AgentsPage agents={SAMPLE_AGENTS} narrow start="user/triage" demo="refused" onSetWish={async () => {}} {...AGENT_FILES} />
      </section>
      <section aria-label="Agents, cannot run" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">An agent that cannot run yet, and one with no tools</span>
        <AgentsPage agents={SAMPLE_AGENTS.filter((agent) => agent.name === "worker" || agent.name === "advisor")} start="bundled/worker" />
      </section>
      {(
        [
          ["Wish table, local models only", "local", WISH_AGENTS_LOCAL],
          ["Wish table, mixed", "mixed", WISH_AGENTS_MIXED],
          ["Wish table, cloud models only", "cloud", WISH_AGENTS_CLOUD],
        ] as const
      ).map(([title, setup, agents]) => (
        <section key={setup} aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{title}</span>
          <AgentsPage agents={agents} setup={setup} onSetWish={async () => {}} />
        </section>
      ))}
      {(
        [
          ["Finished helpers, the defaults", { keep_days: 7, keep_problem_days: 30 }, {}],
          ["Finished helpers, for ever", { keep_days: 0, keep_problem_days: 0 }, {}],
          ["Finished helpers, a value the config refused", { keep_days: 7, keep_problem_days: 30 }, { "agents.keep_days": "Input should be greater than or equal to 0" }],
        ] as const
      ).map(([title, values, errors]) => (
        <section key={title} aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{title}</span>
          <FinishedHelpers values={values} errors={errors} failure={null} onSave={() => {}} />
        </section>
      ))}
      <section aria-label="Agents, tab Agents" className="flex h-96 flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Tabs: Agents, the list and detail fill the page</span>
        <AgentsTabs tab="agents" onTab={() => {}} agents={<AgentsPage agents={SAMPLE_AGENTS} start="bundled/explorer" onSetWish={async () => {}} />} rules={null} />
      </section>
      <section aria-label="Agents, tab Rules" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Tabs: Rules, one block each</span>
        <AgentsTabs
          tab="rules"
          onTab={() => {}}
          agents={null}
          rules={
            <div className="flex max-w-column flex-col gap-3">
              <UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />
              <DefaultLimits values={{ keep_days: 7, keep_problem_days: 30 }} errors={{}} failure={null} onSaveLimit={() => {}} />
              <FinishedHelpers values={{ keep_days: 7, keep_problem_days: 30 }} errors={{}} failure={null} onSave={() => {}} />
            </div>
          }
        />
      </section>
      <section aria-label="Agents, tabs narrow" className="flex h-96 max-w-md flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Tabs, narrow: the tab list and one column</span>
        <AgentsTabs tab="agents" onTab={() => {}} agents={<AgentsPage agents={SAMPLE_AGENTS} narrow onSetWish={async () => {}} />} rules={null} />
      </section>
      <section aria-label="Agents, empty" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Empty</span>
        <AgentsPage agents={[]} />
      </section>
    </div>
  );
}

/** Settings → Agents → Measure: the list in its states, a run in progress, stopped and finished, and the tab with its dot. Its own section so axe has one smaller tree each. */
function MeasureDemo() {
  return (
    <div className="flex flex-col gap-4">
      {(
        [
          ["Measure, new measurement: a tight arm ticked, the box not yet", <MeasureListView key="a" arms={SAMPLE_ARMS} history={SAMPLE_HISTORY} running={null} ticked={["local-32k"]} error={null} onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />],
          ["Measure, new measurement: ready to start", <MeasureListView key="b" arms={SAMPLE_ARMS} history={SAMPLE_HISTORY} running={null} ticked={["local-32k", "budget"]} saved error={null} onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />],
          ["Measure, no room now: a warning, the arm can still be ticked at your own risk", <MeasureListView key="c" arms={SAMPLE_ARMS_NO_ROOM} history={[]} running={null} ticked={["local-32k"]} error={null} onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />],
          ["Measure, the asks to read before anything starts", <MeasureListView key="c2" arms={SAMPLE_ARMS} asks={SAMPLE_ASKS} asksOpen history={[]} running={null} error={null} onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />],
          ["Measure, one runs: Start is off and the list says so", <MeasureListView key="d" arms={SAMPLE_ARMS} history={SAMPLE_HISTORY_RUNNING} running="m1" error={null} onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />],
          ["Measure, a start the daemon refused", <MeasureListView key="e" arms={SAMPLE_ARMS} history={SAMPLE_HISTORY} running={null} ticked={["budget"]} error="A measurement is already running." onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />],
          ["Measure, a run in progress", <MeasureRunView key="f" measurement={SAMPLE_RUNNING} live={SAMPLE_LIVE} plan={SAMPLE_ARMS} error={null} onBack={() => {}} onStop={() => {}} onResume={() => {}} onApply={() => {}} onDelete={() => {}} />],
          ["Measure, a run with a row opened: the message, the facts, the answer, and the parameters", <MeasureRunView key="f2" measurement={SAMPLE_RUNNING} live={SAMPLE_LIVE} plan={SAMPLE_ARMS} firstOpen error={null} onBack={() => {}} onStop={() => {}} onResume={() => {}} onApply={() => {}} onDelete={() => {}} />],
          ["Measure, stopped at the memory floor after a start at your own risk: the rest needs the box", <MeasureRunView key="g2" measurement={SAMPLE_STOPPED_OWN_RISK} live={null} plan={SAMPLE_ARMS_NO_ROOM} error={null} onBack={() => {}} onStop={() => {}} onResume={() => {}} onApply={() => {}} onDelete={() => {}} />],
          ["Measure, a stopped run", <MeasureRunView key="g" measurement={SAMPLE_STOPPED} live={null} plan={[{ ...SAMPLE_ARMS[0], verdict: "fits" } as (typeof SAMPLE_ARMS)[number]]} error={null} onBack={() => {}} onStop={() => {}} onResume={() => {}} onApply={() => {}} onDelete={() => {}} />],
          ["Measure, a finished run with its proposal", <MeasureRunView key="h" measurement={SAMPLE_DONE} live={null} plan={[]} error={null} onBack={() => {}} onStop={() => {}} onResume={() => {}} onApply={() => {}} onDelete={() => {}} />],
          ["Measure, a finished run whose numbers could not be written", <MeasureRunView key="i" measurement={SAMPLE_DONE} live={null} plan={[]} error="Could not write the numbers." onBack={() => {}} onStop={() => {}} onResume={() => {}} onApply={() => {}} onDelete={() => {}} />],
        ] as const
      ).map(([title, body]) => (
        <section key={title} aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{title}</span>
          {body}
        </section>
      ))}
      <section aria-label="Agents, tab Measure" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Tabs: Measure, with the dot while a measurement runs</span>
        <AgentsTabs tab="measure" onTab={() => {}} agents={null} rules={null} measuring measure={<MeasureListView arms={SAMPLE_ARMS} history={SAMPLE_HISTORY_RUNNING} running="m1" error={null} onStart={() => {}} onCheck={() => {}} onOpen={() => {}} />} />
      </section>
    </div>
  );
}

/** Settings → Agents, Use helpers: the three positions, one error, and the card "Ask me first" shows. Small parts only. */
function UseHelpersDemo() {
  const batch = (label: string, args: Record<string, unknown>, extra: { sending?: boolean; error?: string } = {}) => (
    <div key={label}>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="rounded-lg border border-line bg-bg p-4">
        <DockView
          busy
          meter={<Meter state="waiting" runStartedAt={null} />}
          approval={<HelperBatchCard model={helperCardOf({ args })} sending={extra.sending} error={extra.error ?? null} onAnswer={() => {}} />}
          composer={<DemoComposer busy />}
        />
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {(["when_needed", "ask", "never"] as const).map((value) => (
        <section key={value} aria-label={`Use helpers, ${value}`} className="rounded-lg border border-line bg-bg p-4">
          <UseHelpers value={value} delegate={SAMPLE_DELEGATE} onChoose={() => {}} />
        </section>
      ))}
      <section aria-label="Use helpers, numbers changed" className="rounded-lg border border-line bg-bg p-4">
        <UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} onChoose={() => {}} />
      </section>
      <section aria-label="Use helpers, measured" className="rounded-lg border border-line bg-bg p-4">
        <UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} measurement={{ date: "23 Nov", model: "qwen3.8:27b" }} onChoose={() => {}} />
      </section>
      <section aria-label="Use helpers, a wrong value" className="rounded-lg border border-line bg-bg p-4">
        <UseHelpers value="ask" errors={{ "agents.use_helpers": "Not one of when_needed, ask, never." }} onChoose={() => {}} />
      </section>
      {batch("Ask me first, one helper", { agent: "explorer", brief: "List every call site of httpx and the file each is in." })}
      {batch("Ask me first, three helpers", {
        batch: [
          { agent: "explorer", brief: "Call sites of httpx", label: "call sites" },
          { agent: "explorer", brief: "What the 0.28 changelog changes for a client", label: "changelog" },
          { agent: "worker", brief: "Upgrade httpx in pyproject.toml, fix what breaks, run just test.", label: "upgrade" },
        ],
      })}
      {batch("Ask me first, the answer is on its way", { agent: "explorer", brief: "List every call site of httpx." }, { sending: true })}
      <div className="max-w-sm">
        {batch("Ask me first, phone width, the answer failed", { agent: "worker", brief: "Upgrade httpx." }, { error: "Could not send the answer. Try again." })}
      </div>
    </div>
  );
}

/** Settings → Agents, the limits: the Limits block of one agent in its states, and the limits for every helper. */
function AgentLimitsDemo() {
  return (
    <div className="flex flex-col gap-4">
      {(
        [
          ["Limits, read", "The Limits block: five facts, and a quiet note under a value that config.toml sets", SAMPLE_CONFIG_LIMITS, undefined],
          ["Limits, editing", "Edit: tool calls, working time, cost and tokens as boxes, with Save and Cancel", SAMPLE_AGENTS.find((agent) => agent.name === "triage"), "limits"],
          ["Limits, an error", "A refusal from the daemon is a line in the form, and what was typed stays", SAMPLE_AGENTS.find((agent) => agent.name === "triage"), "limits-error"],
          ["Limits, a project agent", "A project agent has no Edit, only a note", SAMPLE_AGENTS.find((agent) => agent.origin === "project" && agent.trusted !== false), undefined],
        ] as const
      ).map(([title, caption, agent, demo]) =>
        agent === undefined ? null : (
          <section key={title} aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
            <span className="font-mono text-xs text-faint">{caption}</span>
            <LimitsBlock row={agentRow(agent)} demo={demo} onSetLimits={async () => {}} />
          </section>
        ),
      )}
      {(
        [
          ["Limits for every helper, set", { keep_days: 7, keep_problem_days: 30, max_calls: 20, working_seconds: 600, max_cost: 1.5, max_tokens: null }, {}, "mixed"],
          ["Limits for every helper, cloud only: cost first", { keep_days: 7, keep_problem_days: 30, max_cost: 1.5 }, {}, "cloud"],
          ["Limits for every helper, a wrong value", { keep_days: 7, keep_problem_days: 30 }, { "agents.max_calls": "Enter a whole number, 1 or more." }, "mixed"],
        ] as const
      ).map(([title, values, errors, setup]) => (
        <section key={title} aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{title}</span>
          <DefaultLimits values={values} errors={errors} failure={null} setup={setup} onSaveLimit={() => {}} />
        </section>
      ))}
    </div>
  );
}

/** Settings → Memory: a tab with a row of each kind, a tab with nothing in it, and memory off. */
function MemoryDemo() {
  const rowActions = { onEdit: async () => {}, onDelete: async () => {}, onAlways: async () => {}, onPrivacy: async () => {} };
  const common = {
    onScope: () => {},
    onQuery: () => {},
    onMore: null,
    rowActions,
    onScopePrivacy: async () => {},
    onExport: async () => {},
    problem: null,
    listLoading: false,
    notice: null,
    settings: SAMPLE_MEMORY_SETTINGS,
  };
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Memory, You" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">You, with a proposal and a local row with no local model</span>
        <MemoryView {...common} scope="you" query="" counts={SAMPLE_MEMORY_COUNTS} items={SAMPLE_MEMORIES.slice(0, 3)} total={3} />
      </section>
      <section aria-label="Memory, This project" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">This project, with a note that may be out of date</span>
        <MemoryView {...common} scope="project" query="" counts={SAMPLE_MEMORY_COUNTS} items={SAMPLE_MEMORIES.slice(3, 4)} total={1} />
      </section>
      <section aria-label="Memory, empty" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Nothing remembered yet</span>
        <MemoryView {...common} scope="history" query="" counts={{}} items={[]} total={0} />
      </section>
      <section aria-label="Memory, off" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Memory off</span>
        <MemoryView {...common} notice={{ kind: "off", text: MEMORY_OFF_TEXT }} scope="you" query="" counts={undefined} items={[]} total={0} />
      </section>
    </div>
  );
}

/** Settings › Models in each state: all starred, Ollama running, stopped, missing and downloading, a hosted provider with and without a key, and oMLX. */
function ModelsDemo() {
  return (
    <div className="flex flex-col gap-4">
      {MODELS_CASES.map(({ label, pulls, ...props }) => (
        <section key={label} aria-label={`Models, ${label}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label}</span>
          <ModelsView {...props} pulls={pulls ?? NO_PULLS} setup={IDLE_SETUP} actions={NO_ACTIONS} />
        </section>
      ))}
    </div>
  );
}

/** Get models, the page that takes the place of Settings › Models, in each state. A fixed height shows that only the body scrolls. */
function GetModelsDemo() {
  return (
    <div className="flex flex-col gap-4">
      {GET_CASES.map(({ label, props, pulls }) => (
        <section key={label} aria-label={`Get models, ${label}`} className="flex h-160 flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label}</span>
          <ModelsView {...props} pulls={pulls ?? NO_PULLS} setup={IDLE_SETUP} actions={NO_ACTIONS} />
        </section>
      ))}
    </div>
  );
}

/** Settings → Routing in each state: auto with limits, no frontier model, never pay, local, pinned, a save error, a phone. */
function RoutingDemo() {
  const none = () => {};
  return (
    <div className="flex flex-col gap-4">
      {ROUTING_CASES.map((item) => (
        <section key={item.label} aria-label={`Routing, ${item.label}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{`Routing, ${item.label}`}</span>
          <div className={item.narrow ? "w-sm max-w-full" : undefined}>
            <RoutingView
              values={item.values}
              listing={ROUTING_LISTING}
              pulls={{ active: new Map(), failed: new Map() }}
              errors={item.errors}
              window={item.note === null ? NO_LOCAL_WINDOW : PLANNED_WINDOW}
              spentToday={0.42}
              onChange={none}
              onOpenContext={none}
              folderBrowser={() => <p className="p-3 text-sm text-muted">The folder browser opens here.</p>}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

/** Settings → Context: Auto with a hosted model, a fixed window, Ollama's, no window known, and a save error. */
function ContextDemo() {
  return (
    <div className="flex flex-col gap-4">
      {CONTEXT_CASES.map((item) => (
        <section key={item.label} aria-label={`Context, ${item.label}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{`Context, ${item.label}`}</span>
          <ContextView values={item.values} listing={ROUTING_LISTING} errors={item.errors} window={item.window} models={item.models} onChange={() => {}} />
        </section>
      ))}
    </div>
  );
}

/** Settings → Usage, with a week of calls and with none. */
function UsageDemo() {
  return (
    <div className="flex flex-col gap-4">
      {[
        ["Usage, filled, with the cost of helpers", SAMPLE_USAGE_WITH_HELPERS],
        ["Usage, empty", EMPTY_USAGE],
      ].map(([label, result]) => (
        <section key={label as string} aria-label={label as string} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label as string}</span>
          <UsageView result={result as typeof SAMPLE_USAGE} />
        </section>
      ))}
    </div>
  );
}

function McpTabsDemo() {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(["a", "e"]));
  const none = new Set<string>();
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="MCP servers, Catalog" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Catalog</span>
        <CatalogView entries={SAMPLE_CATALOG} onAdd={() => {}} />
      </section>
      <section aria-label="MCP servers, Import with nothing picked" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Import, nothing picked</span>
        <ImportListView sources={SAMPLE_SCAN.sources} picked={none} names={{}} values={{}} busy={false} onPick={() => {}} onName={() => {}} onValue={() => {}} onImport={() => {}} />
      </section>
      <section aria-label="MCP servers, Import with some picked" className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
        <span className="font-mono text-xs text-faint">Import, some picked</span>
        <ImportListView
          sources={SAMPLE_SCAN.sources}
          picked={picked}
          names={{}}
          values={{}}
          busy={false}
          onPick={(keys, on) =>
            setPicked((now) => {
              const next = new Set(now);
              for (const key of keys) {
                if (on) next.add(key);
                else next.delete(key);
              }
              return next;
            })
          }
          onName={() => {}}
          onValue={() => {}}
          onImport={() => {}}
        />
      </section>
    </div>
  );
}

/** The welcome page in each step and state, in a box of its own: it is a page, so it fills its frame. */
function WelcomeDemo() {
  return (
    <div className="flex flex-col gap-4">
      {WELCOME_CASES.map(({ label, props }) => (
        <section key={label} aria-label={`Welcome, ${label}`} className="flex flex-col gap-1">
          <span className="font-mono text-xs text-faint">{label}</span>
          <div className="relative flex h-160 flex-col overflow-hidden rounded-lg border border-line bg-bg">
            <WelcomeView {...props} />
          </div>
        </section>
      ))}
    </div>
  );
}

function TraceDemo({ label, runs }: { label: string; runs: TraceRunSpan[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <figure className="w-full">
      <figcaption className="mb-1 font-mono text-xs text-faint">{label}</figcaption>
      <div className="flex h-64 flex-col overflow-hidden rounded-md border border-line bg-bg">
        <TraceTree runs={runs} selected={selected} onSelect={setSelected} />
      </div>
    </figure>
  );
}

function SummaryDemo({ label, runs, events }: { label: string; runs: TraceRunSpan[]; events?: TraceContextEvent[] }) {
  return (
    <figure className="w-full">
      <figcaption className="mb-1 font-mono text-xs text-faint">{label}</figcaption>
      <div className="flex items-center rounded-md border border-line bg-bg px-4 py-2">
        <TraceSummary runs={runs} events={events} />
      </div>
    </figure>
  );
}

/** The gallery has no daemon to read an artifact from, so "Open full output" opens a stand-in. */
function GalleryArtifact({ artifactId, open, onOpenChange }: { sessionId: string; artifactId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Full output</DialogTitle>
        <DialogDescription>{`Artifact ${artifactId}`}</DialogDescription>
        <DialogClose asChild>
          <Button size="sm" className="mt-3">Close</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

function DetailDemo({ label, result }: { label: string; result: TraceSpanResult }) {
  return (
    <figure className="w-full">
      <figcaption className="mb-1 font-mono text-xs text-faint">{label}</figcaption>
      <div className="flex h-96 flex-col overflow-hidden rounded-md border border-line bg-bg">
        <SpanDetail result={result} sessionId="s_gallery" Artifact={GalleryArtifact} />
      </div>
    </figure>
  );
}

/** The inspector's column as the chat shows it: the header, the summary, the tree, and the span's detail under it. */
function InspectorDemo({ label, runs, result, minimum = false }: { label: string; runs: TraceRunSpan[]; result: TraceSpanResult; minimum?: boolean }) {
  const [selected, setSelected] = useState<string | null>("c_2");
  return (
    <figure className="w-full">
      <figcaption className="mb-1 font-mono text-xs text-faint">{label}</figcaption>
      <aside aria-label="Trace inspector" className={`flex h-160 ${minimum ? "w-inspector-min" : "w-inspector"} max-w-full flex-col overflow-hidden rounded-md border border-line bg-surface`}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h3 className="text-sm font-medium">Trace</h3>
          <div className="flex-1" />
          <span className="px-1.5 text-xs text-clay-ink underline underline-offset-2">Open full ↗</span>
        </div>
        <div className="flex items-center border-b border-line px-3 py-1.5">
          <TraceSummary runs={runs} stacked />
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col">
          <TraceTree runs={runs} selected={selected} onSelect={setSelected} compact />
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col border-t border-line">
          <SpanDetail result={result} sessionId="s_gallery" Artifact={GalleryArtifact} />
        </div>
      </aside>
    </figure>
  );
}

function PanelBody({ theme, prefix }: { theme: "slip" | "kiln"; prefix: string }) {
  const anchor = (title: string) => prefix + slug(title);
  return (
    <section data-theme={theme} aria-label={`${theme} theme`} className="rounded-lg border border-line bg-bg p-4 text-ink">
      <h2 className="font-prose text-xl">{theme}</h2>

      <Only id="trace">
      <Group title="Trace">
        <SummaryDemo label="Summary, context growing" runs={GROWING_TRACE} />
        <SummaryDemo label="Summary, ticks where golem cleared and grew the window" runs={GROWING_TRACE} events={GROWING_EVENTS} />
        <SummaryDemo label="Summary, 26 model calls" runs={LONG_TRACE} />
        <SummaryDemo label="Summary, a session from before traces" runs={OLD_TRACE} />
        <InspectorDemo label="The inspector beside the chat" runs={SHORT_TRACE} result={TOOL_DETAIL} />
        <InspectorDemo label="The inspector at its least width" runs={SHORT_TRACE} result={TOOL_DETAIL} minimum />
        <TraceDemo label="Short trace" runs={SHORT_TRACE} />
        <TraceDemo label="Long trace, 25 model calls" runs={LONG_TRACE} />
        <TraceDemo label="A failed and a denied tool" runs={FAILED_TRACE} />
        <TraceDemo label="A tool with an approval wait" runs={APPROVAL_TRACE} />
        <TraceDemo label="A session from before traces" runs={OLD_TRACE} />
        <DetailDemo label="A model call: context, reply, metadata" result={MODEL_DETAIL} />
        <DetailDemo label="A model call, nearly full, with MCP tools" result={FULL_DETAIL} />
        <DetailDemo label="A model call with a summary, a cleared result and the reply reserve" result={CLEARED_DETAIL} />
        <DetailDemo label="Ollama input over num_ctx" result={NUM_CTX_DETAIL} />
        <DetailDemo label="Ollama with no ctx: window unknown" result={UNKNOWN_WINDOW_DETAIL} />
        <DetailDemo label="Ollama dropped older messages (proven)" result={CUT_YES_DETAIL} />
        <DetailDemo label="Ollama probably dropped older messages" result={CUT_LIKELY_DETAIL} />
        <DetailDemo label="Ollama probably cut the prompt in the middle" result={CUT_MIDDLE_DETAIL} />
        <DetailDemo label="A tool with a big output" result={TOOL_DETAIL} />
        <DetailDemo label="A tool with an edited approval" result={APPROVAL_DETAIL} />
        <DetailDemo label="Not recorded" result={OLD_DETAIL} />
        <DetailDemo label="A system prompt in two sections" result={SECTIONS_DETAIL} />
        <DetailDemo label="No system prompt sent" result={NO_PROMPT_DETAIL} />
      </Group>
      </Only>

      <Only id="button">
      <Group title="Button">
        <Button kind="primary">Primary</Button>
        <Button kind="secondary">Secondary</Button>
        <Button kind="ghost">Ghost</Button>
        <Button kind="ink">Ink</Button>
        <Button kind="danger">Danger</Button>
        <Button kind="primary" size="sm">Small</Button>
        <Button kind="secondary" size="sm">Small</Button>
        <Button kind="primary" disabled>Disabled</Button>
        <Button kind="secondary" disabled>Disabled</Button>
        <Button kind="primary">
          Allow once <Kbd>↵</Kbd>
        </Button>
      </Group>
      </Only>

      <Only id="icon-button">
      <Group title="Icon button">
        <IconButton label="New session"><PlusIcon /></IconButton>
        <IconButton label="Close"><CloseIcon /></IconButton>
        <IconButton label="More"><ChevronDownIcon /></IconButton>
        <IconButton label="Send"><SendIcon /></IconButton>
        <IconButton label="Stop"><StopIcon /></IconButton>
        <IconButton label="Search"><SearchIcon /></IconButton>
        <IconButton label="Disabled" disabled><CopyIcon /></IconButton>
      </Group>
      </Only>

      <Only id="type">
      <Group title="Type">
        {TYPE_SCALE.map(([token, sample, className]) => (
          <p key={token} className="flex w-full items-baseline gap-3">
            <span className="w-20 shrink-0 text-meta text-faint">{token}</span>
            <span className={className}>{sample}</span>
          </p>
        ))}
        <p className="w-full text-body">
          A literal sits in the sentence as <Code>golem install</Code>, or muted as <Code tone="muted">~/.golem/config.toml</Code>.
        </p>
      </Group>
      </Only>

      <Only id="copy">
      <Group title="Copy">
        <CopyButton text="golem install" label="command" />
        <IconButton label="Copied"><CheckIcon className="text-allow" /></IconButton>
        <CopyCommand command="golem install" />
      </Group>
      </Only>

      <Only id="connection-screens">
      <section className="mt-6" id={anchor("Connection screens")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Connection screens</h3>
        <div className="grid gap-4">
          {SCREENS.map(([snapshot, host], index) => {
            const spec = connectionScreen(snapshot, host);
            return spec ? (
              <div key={index} className="rounded-lg border border-line bg-bg">
                <ConnectionScreen spec={spec} headingLevel="h4" />
              </div>
            ) : null;
          })}
        </div>
      </section>
      </Only>

      <Only id="sessions-panel">
      <section className="mt-6" id={anchor("Sessions panel")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Sessions panel</h3>
        <div className="flex flex-wrap gap-4">
          <div className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel
              title="Sessions"
              label={`Sessions, ${theme}`}
              chip={<WaitingChip count={2} onOpen={() => {}} />}
              action={
                <IconButton label="Start new session" className="size-7">
                  <PlusIcon />
                </IconButton>
              }
              onHide={() => {}}
              foot={<ConnectionStrip snapshot={RECONNECTING} />}
            >
              <SessionsPanel
                sessions={SESSIONS}
                selectedId="b"
                now={NOW}
                onNavigate={() => {}}
                actions={{ rename: () => Promise.resolve(), close: () => Promise.resolve() }}
              />
            </SidebarPanel>
          </div>
          <div className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel title="Sessions" label={`Sessions, empty, ${theme}`} onHide={() => {}}>
              <SessionsPanel sessions={[]} selectedId={null} now={NOW} onNavigate={() => {}} />
            </SidebarPanel>
          </div>
        </div>
      </section>
      </Only>

      <Only id="helpers-in-the-list">
      <section className="mt-6" id={anchor("Helpers in the list")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Helpers in the list</h3>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["lead open, helpers working", HELPER_SESSIONS, "lead-a"],
              ["lead open, helpers finished", HELPER_SESSIONS, "lead-c"],
              ["another chat open: squares only", HELPER_SESSIONS, "other"],
              ["a fork next to helpers", HELPER_FORK_SESSIONS, "lead-a"],
            ] as const
          ).map(([label, sessions, selected]) => (
            <figure key={label} className="m-0 flex flex-col gap-1">
              <figcaption className="font-mono text-xs text-faint">{label}</figcaption>
              <div className="h-72 w-67 overflow-hidden rounded-lg border border-line">
                <SidebarPanel title="Sessions" label={`Sessions, ${label}, ${theme}`} onHide={() => {}}>
                  <SessionsPanel sessions={sessions} selectedId={selected} now={NOW} onNavigate={() => {}} />
                </SidebarPanel>
              </div>
            </figure>
          ))}
        </div>
      </section>
      </Only>

      <Only id="helper-card">
      <section className="mt-6" id={anchor("Helper card")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Helper card</h3>
        <div aria-label={`Helpers of Map the daemon modules, ${theme}`} role="group" className="w-80 overflow-hidden rounded-lg border border-line bg-surface text-sm text-ink shadow-soft">
          <HelperRowCardBody helpers={CARD_HELPERS} leadId="lead-a" now={NOW} actions={CARD_ACTIONS} />
        </div>
      </section>
      </Only>

      <Only id="routines">
      <section className="mt-6" id={anchor("Routines")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Routines</h3>
        <div className="flex flex-wrap gap-4">
          <div className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel title="Routines" label={`Routines, ${theme}`} onHide={() => {}}>
              <RoutinesPanel list={SAMPLE_LIST} selected={{ name: "morning-brief", folder: null }} now={ROUTINES_NOW} onNavigate={() => {}} />
            </SidebarPanel>
          </div>
          <div className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel title="Routines" label={`Routines, empty, ${theme}`} onHide={() => {}}>
              <RoutinesPanel list={{ routines: [] }} selected={null} now={ROUTINES_NOW} onNavigate={() => {}} />
            </SidebarPanel>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-bg p-5" role="region" aria-label={`Routine detail, ${theme}`}>
          <RoutineDetail
            routine={SAMPLE_MORNING_BRIEF}
            runs={SAMPLE_RUNS}
            now={ROUTINES_NOW}
            onNavigate={() => {}}
            onRun={() => Promise.resolve({ routine_run_id: "rr_6", session_id: "s_6" })}
            onRemove={() => Promise.resolve()}
          />
        </div>
        <div className="mt-4 rounded-lg border border-line bg-bg p-5" role="region" aria-label={`Routines, nothing set up, ${theme}`}>
          <RoutinesEmpty onNavigate={() => {}} />
        </div>
      </section>
      </Only>

      <Only id="runs">
      <section className="mt-6" id={anchor("Runs")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Runs</h3>
        <div className="flex flex-wrap gap-4">
          <div className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel title="Runs" label={`Runs, ${theme}`} onHide={() => {}}>
              <RunsPanel runs={SAMPLE_RUN_LIST} selected="s_wait" now={RUNS_NOW} onNavigate={() => {}} />
            </SidebarPanel>
          </div>
          <div className="h-96 w-67 overflow-hidden rounded-lg border border-line">
            <SidebarPanel title="Runs" label={`Runs, empty, ${theme}`} onHide={() => {}}>
              <RunsPanel runs={[]} selected={null} now={RUNS_NOW} onNavigate={() => {}} />
            </SidebarPanel>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-bg p-5" role="region" aria-label={`Runs list, ${theme}`}>
          <RunsList runs={SAMPLE_RUN_LIST} now={RUNS_NOW} onNavigate={() => {}} />
        </div>
        <div className="mt-4 flex flex-col gap-3 overflow-hidden rounded-lg border border-line bg-bg" role="region" aria-label={`Routine banners, ${theme}`}>
          <RunBanner run={SAMPLE_WAITING_RUN} label="Routine run, schedule" now={RUNS_NOW} onNavigate={() => {}} />
          <RunBanner run={{ ...SAMPLE_WAITING_RUN, status: "running", approvals: 0, trigger: "manual" }} label="Routine run, manual" now={RUNS_NOW} onNavigate={() => {}} />
          <RunBanner
            run={{ ...SAMPLE_WAITING_RUN, routine: "receipts", status: "succeeded", approvals: 0, trigger: "watch", watch_path: "/Users/you/Downloads/receipt-0412.pdf" }}
            label="Routine run, file"
            now={RUNS_NOW}
            onNavigate={() => {}}
          />
        </div>
      </section>
      </Only>

      <Only id="rail">
      <section className="mt-6" id={anchor("Rail")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Rail</h3>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["empty", { state: "idle", inboxCount: 0, settingsDot: false, connected: "connected", picked: "sessions" }],
              ["2 waiting", { state: "waiting", inboxCount: 2, settingsDot: false, connected: "connected", picked: "inbox" }],
              ["setup dot", { state: "idle", inboxCount: 0, settingsDot: true, connected: "connected", picked: "routines" }],
              ["connection lost", { state: "offline", inboxCount: 0, settingsDot: true, connected: "offline", picked: null }],
            ] as const
          ).map(([label, props]) => (
            <figure key={label} className="m-0">
              <div className="h-136 overflow-hidden rounded-lg border border-line">
                <Rail
                  {...props}
                  label={`Sidebar rail, ${label}, ${theme}`}
                  version="0.9.1"
                  onPick={() => {}}
                  onNew={() => {}}
                  onSearch={() => {}}
                  onSettings={() => {}}
                />
              </div>
              <figcaption className="mt-1 font-mono text-xs text-faint">{label}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      </Only>

      <Only id="sessions-flyout">
      <section className="mt-6" id={anchor("Sessions flyout")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Sessions flyout</h3>
        <figure className="m-0">
          <div
            role="dialog"
            aria-label={`Sessions, flyout, ${theme}`}
            className="max-h-96 w-67 overflow-y-auto rounded-lg border border-line-strong bg-surface p-2 text-sm text-ink shadow-soft"
          >
            <SessionsPanel
              sessions={SESSIONS}
              selectedId="b"
              now={NOW}
              onNavigate={() => {}}
              actions={{ rename: () => Promise.resolve(), close: () => Promise.resolve() }}
            />
          </div>
          <figcaption className="mt-1 font-mono text-xs text-faint">opens beside the Sessions icon while the panel is hidden</figcaption>
        </figure>
      </section>
      </Only>

      <Only id="inbox-panel">
      <section className="mt-6" id={anchor("Inbox panel")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Inbox panel</h3>
        <div className="flex flex-wrap items-start gap-4">
          <figure className="m-0 w-72">
            <InboxPanel items={[]} onAnswer={() => {}} onOpen={() => {}} />
            <figcaption className="mt-1 font-mono text-xs text-faint">empty</figcaption>
          </figure>
          <figure className="m-0 w-72">
            <InboxPanel items={SAMPLE_INBOX} label={`Inbox, ${theme}`} onAnswer={() => {}} onOpen={() => {}} />
            <figcaption className="mt-1 font-mono text-xs text-faint">two approvals and a consent</figcaption>
          </figure>
          <figure className="m-0 w-72">
            <InboxPanel
              items={SAMPLE_INBOX}
              label={`Inbox, answering and failed, ${theme}`}
              busy={{ [inboxKey(SAMPLE_INBOX[2]!)]: true }}
              errors={{ [inboxKey(SAMPLE_INBOX[1]!)]: "golem is still answering. Stop it first, or wait." }}
              onAnswer={() => {}}
              onOpen={() => {}}
            />
            <figcaption className="mt-1 font-mono text-xs text-faint">one card answering, one with an error</figcaption>
          </figure>
          <figure className="m-0 w-72">
            <InboxPanel items={SAMPLE_HELPER_INBOX} groups={SAMPLE_HELPER_GROUPS} label={`Inbox, helpers ask, ${theme}`} onAnswer={() => {}} onOpen={() => {}} />
            <figcaption className="mt-1 font-mono text-xs text-faint">a lead whose helpers ask, one of them five helpers</figcaption>
          </figure>
        </div>
      </section>
      </Only>

      <Only id="folder-browser">
      <section className="mt-6" id={anchor("Folder browser")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Folder browser</h3>
        <FolderBrowserDemo theme={theme} />
      </section>
      </Only>

      <Only id="setup-form">
      <section className="mt-6" id={anchor("Setup form")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Setup form</h3>
        <SetupFormDemo />
      </section>
      </Only>

      <Only id="mcp-servers">
      <section className="mt-6" id={anchor("MCP servers")}>
        <h3 className="mb-2 font-mono text-xs text-faint">MCP servers</h3>
        <McpTabsDemo />
      </section>
      </Only>

      <Only id="skills">
      <section className="mt-6" id={anchor("Skills")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Skills</h3>
        <SkillsDemo />
      </section>
      </Only>

      <Only id="agents">
      <section className="mt-6" id={anchor("Agents")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Agents</h3>
        <AgentsDemo />
      </section>
      </Only>

      <Only id="measure">
      <section className="mt-6" id={anchor("Measure")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Measure</h3>
        <MeasureDemo />
      </section>
      </Only>

      <Only id="agent-limits">
      <section className="mt-6" id={anchor("Agent limits")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Agent limits</h3>
        <AgentLimitsDemo />
      </section>
      </Only>

      <Only id="use-helpers">
      <section className="mt-6" id={anchor("Use helpers")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Use helpers</h3>
        <UseHelpersDemo />
      </section>
      </Only>

      <Only id="memory">
      <section className="mt-6" id={anchor("Memory")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Memory</h3>
        <MemoryDemo />
      </section>
      </Only>

      <Only id="chat-stage">
      <section className="mt-6" id={anchor("Chat stage")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Chat stage</h3>
        <div className="rounded-lg border border-line bg-bg p-4">
          <Stage number={1} title="Before you write" hint="golem puts these lines in every chat, word for word">
            <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">The content of the stage.</p>
          </Stage>
          <YouRow>Plan a weekend in Porto and save it to my notes</YouRow>
          <Stage number={2} title="While it works" hint="how far it goes before it checks with you" last>
            <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">The last stage has no line below its badge.</p>
          </Stage>
        </div>
      </section>
      </Only>

      <Only id="settings-chat">
      <section className="mt-6" id={anchor("Settings chat")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Settings › Chat</h3>
        <div className="rounded-lg border border-line bg-bg p-4">
          <GalleryChatSettings />
        </div>
      </section>
      </Only>

      <Only id="mode-track">
      <section className="mt-6" id={anchor("Mode track")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Settings › Chat › While it works: the mode track</h3>
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-bg p-4">
          {(["careful", "balanced", "autopilot"] as const).map((item) => (
            <HowFarView key={item} mode={item} planFirst={false} onMode={() => undefined} onPlan={() => undefined} />
          ))}
          <HowFarView mode="balanced" planFirst onMode={() => undefined} onPlan={() => undefined} />
        </div>
      </section>
      </Only>

      <Only id="settings-models">
      <section className="mt-6" id={anchor("Settings models")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Settings › Models</h3>
        <ModelsDemo />
        <h3 className="mb-2 mt-4 font-mono text-xs text-faint">Settings › Models › Get models</h3>
        <GetModelsDemo />
      </section>
      </Only>

      <Only id="routing">
      <section className="mt-6" id={anchor("Routing")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Routing</h3>
        <RoutingDemo />
      </section>
      </Only>

      <Only id="settings-context">
      <section className="mt-6" id={anchor("Settings Context")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Settings › Context</h3>
        <ContextDemo />
      </section>
      </Only>

      <Only id="usage">
      <section className="mt-6" id={anchor("Usage")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Usage</h3>
        <UsageDemo />
      </section>
      </Only>

      <Only id="tools-panel">
      <section className="mt-6" id={anchor("Tools panel")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Tools panel</h3>
        <ToolsOfferDemo />
      </section>
      </Only>

      <Only id="mcp-sign-in">
      <section className="mt-6" id={anchor("MCP sign-in")}>
        <h3 className="mb-2 font-mono text-xs text-faint">MCP sign-in</h3>
        <McpSignInDemo />
      </section>
      </Only>

      <Only id="mcp-token">
      <section className="mt-6" id={anchor("MCP token")}>
        <h3 className="mb-2 font-mono text-xs text-faint">MCP token</h3>
        <McpTokenDemo />
      </section>
      </Only>

      <Only id="welcome-page">
      <section className="mt-6" id={anchor("Welcome page")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Welcome page</h3>
        <WelcomeDemo />
      </section>
      </Only>

      <Only id="download-row">
      <section className="mt-6" id={anchor("Download row")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Download row</h3>
        <DownloadRowDemo />
      </section>
      </Only>

      <Only id="session-title-rename-and-close">
      <section className="mt-6" id={anchor("Session title, rename, and close")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Session title, rename, and close</h3>
        <SessionActionsDemo theme={theme} />
      </section>
      </Only>

      <Only id="empty-screen">
      <section className="mt-6" id={anchor("Empty screen")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Empty screen</h3>
        <div className="flex h-96 flex-col rounded-lg border border-line bg-bg">
          <HomeView
            headingLevel="h4"
            composer={
              <DemoComposer
                size="large"
                barLeft={
                  <>
                    <NewSessionModelChipView label={{ kind: "default", text: "Gemma 4 E4B" }} onOpen={() => {}} />
                    <FolderChip folder="/Users/you/repos/golem" folders={["/Users/you/repos/golem", "/Users/you/notes"]} onChange={() => {}} />
                  </>
                }
              />
            }
          />
        </div>
        <div aria-label="Empty screen, setup left" role="group" className="mt-2 flex h-96 flex-col rounded-lg border border-line bg-bg">
          <HomeView
            headingLevel="h4"
            notice={<FinishSetupStripView onFinish={() => {}} />}
            composer={
              <DemoComposer
                size="large"
                barLeft={
                  <>
                    <NewSessionModelChipView label={{ kind: "none" }} onOpen={() => {}} />
                    <FolderChip folder="/Users/you/repos/golem" folders={["/Users/you/repos/golem"]} onChange={() => {}} />
                  </>
                }
              />
            }
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-line bg-bg p-4">
          <NewSessionModelChipView label={{ kind: "default", text: "Gemma 4 E4B" }} onOpen={() => {}} />
          <NewSessionModelChipView label={{ kind: "pick", text: "Qwen3 8B" }} onOpen={() => {}} />
          <NewSessionModelChipView label={{ kind: "auto", text: "auto · llama3.2:3b" }} onOpen={() => {}} />
          <NewSessionModelChipView label={{ kind: "none" }} onOpen={() => {}} />
        </div>
      </section>
      </Only>

      <Only id="branch-chip-and-menu">
      <section className="mt-6" id={anchor("Branch chip and menu")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Branch chip and menu</h3>
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-line bg-bg p-4">
          <BranchChipView mode="home" folder="/Users/you/repos/golem" shown="main" current="main" changed={0} branches={["main", "fix-x", "release"]} onPick={() => {}} onCreate={() => {}} />
          <BranchChipView mode="home" folder="/Users/you/repos/golem" shown="fix-x" current="main" changed={3} branches={["main", "fix-x", "release"]} sharedWith={["Review untracked files"]} onPick={() => {}} onCreate={() => {}} />
          <BranchChipView mode="session" folder="/Users/you/repos/golem" shown="main" current="main" changed={3} amber branches={["main", "fix-x", "release"]} onPick={() => {}} onCreate={() => {}} />
        </div>
        <div className="mt-2 rounded-lg border border-line bg-bg p-4">
          <BranchSwitchLineView folder="/Users/you/repos/golem" from="main" to="fix-x" create={false} />
          <BranchSwitchLineView folder="/Users/you/repos/golem" from="main" to="fix-y" create />
        </div>
      </section>
      </Only>

      <Only id="dock">
      <section className="mt-6" id={anchor("Dock")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Dock</h3>
        <div className="grid gap-4 rounded-lg border border-line bg-bg p-4">
          <DockView busy={false} meter={<Meter state="idle" runStartedAt={null} />} composer={<DemoComposer />} />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer barRight={<ContextChipView used={32000} window={128000} onOpen={() => {}} />} />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer withNotes strip={<NotesChipView label="2 notes" onOpen={() => {}} onRemoveAll={() => {}} />} />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer barRight={<ContextChipView used={110000} window={128000} onOpen={() => {}} />} />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer barRight={<ContextChipView used={125000} window={128000} onOpen={() => {}} />} />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer barRight={<ContextChipView used={38000} window={100000} cleared={12} onOpen={() => {}} />} />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer barRight={<ContextChipView used={1300} window={16384} windowEstimated onOpen={() => {}} />} />}
          />
          <div aria-label="Mode chips" role="group" className="flex flex-wrap gap-2">
            <ModeChipView own="careful" fallback="balanced" onSelect={() => {}} />
            <ModeChipView own={null} fallback="balanced" onSelect={() => {}} />
            <ModeChipView own="autopilot" fallback="balanced" onSelect={() => {}} />
            <ModeChipView own="autopilot" fallback="balanced" plan onSelect={() => {}} onPlan={() => {}} />
          </div>
          <div aria-label="Route panels" role="group" className="flex flex-wrap gap-3">
            {ROUTE_CHIP_CASES.map(({ label, mode, ladder, spend }) => (
              <div key={label} className="w-80 rounded-lg border border-line bg-surface p-4">
                <RoutePanelView mode={mode} ladder={ladder} spend={spend} onSelect={() => {}} onNavigate={() => {}} />
              </div>
            ))}
          </div>
          <div aria-label="Context chips" role="group" className="flex flex-wrap gap-2">
            {CONTEXT_CHIP_CASES.map(({ label, used, window, source, actions }) => (
              <ContextChipView
                key={label}
                used={used}
                window={window}
                onOpen={() => {}}
                panel={{ reserve: window === null ? null : 4096, source, actions, onRun: async () => {}, onOpenTrace: () => {} }}
              />
            ))}
          </div>
          <ContextBannerView text="The model no longer sees the start of this chat." actions={bestActions(CONTEXT_CHIP_CASES[1]!.actions)} onRun={async () => {}} />
          <WaitHintView text="≈ 3 min to first token on qwen3:27b" />
          <WaitHintView text="≈ 3 min to first token on qwen3:27b · deepseek-chat ≈ 2 s for ≈ $0.01" />
          <DockView
            busy
            meter={<Meter state="thinking" runStartedAt={new Date(NOW - 12_000).toISOString()} />}
            composer={<DemoComposer busy />}
            error="golem is still answering. Stop it first, or wait."
          />
          <DockView
            busy
            meter={<Meter state="waiting" runStartedAt={null} />}
            composer={<DemoComposer busy />}
          />
          <DockView
            busy={false}
            meter={<Meter state="offline" runStartedAt={null} />}
            composer={<DemoComposer disabledReason="Not connected to golem" />}
          />
        </div>
      </section>
      </Only>

      <Only id="composer-row">
      <section className="mt-6" id={anchor("Composer row")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Composer row</h3>
        <div className="grid gap-4 rounded-lg border border-line bg-bg p-4">
          {[720, 560, 460, 360].map((width) => (
            <ComposerRowDemo key={width} width={width} />
          ))}
          <div aria-label="Composer row, home, 460 px" role="group" style={{ width: 460 }} className="max-w-full">
            <DemoComposer
              size="large"
              barLeft={
                <>
                  <NewSessionModelChipView label={{ kind: "default", text: "qwen3.8:27b" }} onOpen={() => {}} />
                  <FolderChip folder="/Users/you/repos/golem" folders={["/Users/you/repos/golem"]} onChange={() => {}} />
                </>
              }
            />
          </div>
        </div>
      </section>
      </Only>

      <Only id="folder-menu">
      <section className="mt-6" id={anchor("Folder menu")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Folder menu</h3>
        <div className="grid gap-4 rounded-lg border border-line bg-bg p-4 sm:grid-cols-2">
          <div aria-label="Folder menu, new session" role="group" className="flex max-h-120 w-96 max-w-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
            <FolderMenuBody
              folder="/Users/you/repos/golem"
              branch="main"
              recent={[
                { path: "/Users/you/repos/golem", branch: "main" },
                { path: "/Users/you/notes", branch: null },
                { path: "/Users/you/repos/golem-docs", branch: "main" },
              ]}
              worktrees={{
                repo: "golem",
                rows: [
                  { path: "/Users/you/repos/golem", branch: "main" },
                  { path: "/Users/you/repos/golem-review", branch: "review/1612" },
                ],
                agents: [
                  { path: "/Users/you/repos/golem/.claude/worktrees/agent-a1", branch: "worktree-agent-a1" },
                  { path: "/Users/you/repos/golem/.claude/worktrees/agent-b2", branch: "worktree-agent-b2" },
                ],
              }}
              home="/Users/you"
              onPick={() => {}}
              onChoose={() => {}}
              onReveal={() => {}}
              onBrowse={() => {}}
              autoFocus={false}
            />
          </div>
          <div aria-label="Folder menu, waiting for the macOS dialog" role="group" className="flex w-96 max-w-full flex-col rounded-lg border border-line bg-surface shadow-soft">
            <FolderMenuBody
              folder="/Users/you/notes"
              branch={null}
              recent={[]}
              worktrees={null}
              home="/Users/you"
              onPick={() => {}}
              onChoose={() => {}}
              waiting
              onCancelWait={() => {}}
              autoFocus={false}
            />
          </div>
          <div aria-label="Folder menu, without the dialog" role="group" className="flex w-96 max-w-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
            <FolderMenuBody folder="/Users/you/notes" branch={null} recent={[{ path: "/Users/you/repos/golem", branch: "main" }]} worktrees={null} home="/Users/you" onPick={() => {}} onBrowse={() => {}} autoFocus={false} />
          </div>
          <div aria-label="Folder menu, open session" role="group" className="w-80 max-w-full rounded-lg border border-line bg-surface shadow-soft">
            <SessionFolderMenuBody folder="/Users/you/repos/golem" branch="main" onCopy={() => {}} onReveal={() => {}} onNewHere={() => {}} onNewElsewhere={() => {}} />
          </div>
        </div>
      </section>
      </Only>

      <Only id="dock-slash-commands">
      <section className="mt-6" id={anchor("Dock, slash commands")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Dock, slash commands</h3>
        <div className="grid gap-4 rounded-lg border border-line bg-bg p-4">
          {[
            { label: "all", initial: "/" },
            { label: "partial", initial: "/mo" },
            { label: "skills", initial: "/skill run " },
          ].map(({ label, initial }) => (
            <div key={label} className="pt-72" data-demo={`suggestions-${label}`}>
              <DockView
                busy={false}
                meter={<Meter state="idle" runStartedAt={null} />}
                composer={<DemoComposer initial={initial} commands={GALLERY_COMMANDS} />}
              />
            </div>
          ))}
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer commands={GALLERY_COMMANDS} />}
            notice={{ text: "Copied the last answer." }}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} />}
            composer={<DemoComposer commands={GALLERY_COMMANDS} />}
            notice={{ text: "Keys are set in a terminal:", command: "golem auth set anthropic" }}
          />
          <CommandsDemo theme={theme} />
        </div>
      </section>
      </Only>

      <Only id="approval">
      <ApprovalDemo />
      </Only>

      <Only id="input-textarea">
      <Group title="Input, textarea">
        <Input aria-label={`Name, ${theme}`} placeholder="Name" />
        <Input aria-label={`Disabled name, ${theme}`} placeholder="Disabled" disabled />
        <Input aria-label={`Folder, ${theme}`} defaultValue="/nowhere" aria-invalid="true" />
        <Textarea aria-label={`Message, ${theme}`} placeholder="Message golem" />
        <Textarea aria-label={`Bad message, ${theme}`} defaultValue="Too long" aria-invalid="true" />
      </Group>
      </Only>

      <Only id="card">
      <Group title="Card">
        <Card>
          <p className="text-sm">A card holds one thing.</p>
          <p className="mt-1 text-xs text-muted">Surface, a soft shadow, and a large radius.</p>
        </Card>
      </Group>
      </Only>

      <Only id="badge">
      <Group title="Badge">
        <Badge>neutral</Badge>
        <Badge tone="clay">clay</Badge>
        <Badge tone="allow">allow</Badge>
        <Badge tone="deny">deny</Badge>
        <Badge tone="wait">wait</Badge>
      </Group>
      </Only>

      <Only id="kbd">
      <Group title="Kbd">
        <Kbd>⌘ K</Kbd>
        <Kbd>⇧ ↵</Kbd>
      </Group>
      </Only>

      <Only id="status-dot">
      <Group title="Status dot">
        {STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-2 text-sm">
            <StatusDot state={state} />
            <span aria-hidden="true" className="font-mono text-xs text-muted">{GOLEM_STATE_LABEL[state]}</span>
          </span>
        ))}
      </Group>
      </Only>

      <Only id="pixel-golem">
      <Group title="Pixel golem">
        {STATES.map((state) => (
          <PixelGolem key={state} state={state} showLabel />
        ))}
        <PixelGolem state="idle" size="sm" />
        <PixelGolem state="idle" size="lg" />
      </Group>
      </Only>

      <Only id="tab-icon-and-title">
      <Group title="Tab icon and title">
        {STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-2 text-sm">
            <img src={faviconHref(state)} alt={`golem tab icon · ${GOLEM_STATE_LABEL[state]}`} className="size-4" />
            <span className="font-mono text-xs text-muted">{tabTitle(state, "Fix the login bug")}</span>
          </span>
        ))}
      </Group>
      </Only>

      <Only id="transcript">
      <section className="mt-6" id={anchor("Transcript")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Transcript</h3>
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
          <TranscriptMessages chat={SAMPLE_CHAT} />
          <ul aria-label="Tool tablets" className="flex list-none flex-col gap-0.5 p-0 font-mono text-xs leading-snug">
            {SAMPLE_TOOLS.map((tool) => (
              <ToolLine key={tool.callId} tool={tool} defaultOpen={tool.status === "running"} />
            ))}
          </ul>
        </div>
      </section>
      </Only>

      <Only id="turn">
      <section className="mt-6" id={anchor("Turn")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Turn</h3>
        <div className="flex flex-col gap-3">
          {(["normal", "verbose", "quiet"] as const).map((detail) => (
            <div key={detail} aria-label={`A turn with four tool steps, ${detail}`} role="group" className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
              <p className="font-mono text-xs text-faint">{detail}</p>
              <TranscriptMessages chat={TURN_CHAT} detail={detail} />
            </div>
          ))}
          {(["normal", "quiet"] as const).map((detail) => (
            <div key={detail} aria-label={`Notices of cleared, summarised and grew, ${detail}`} role="group" className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
              <p className="font-mono text-xs text-faint">notices, {detail}: a clear hides in quiet</p>
              <TranscriptMessages chat={NOTICE_CHAT} detail={detail} />
            </div>
          ))}
          <div aria-label="Undo in the chat" role="group" className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
            <p className="font-mono text-xs text-faint">undo: the newest turn offers Undo this turn; a rewound one is muted and offers Redo</p>
            <TranscriptMessages chat={UNDO_CHAT} undo={UNDO_STATE} />
          </div>
          <div aria-label="Edit cards" role="group" className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-4">
            <p className="font-mono text-xs text-faint">edit cards: an edit, a new file, an edit with no diff kept</p>
            <EditCards
              tools={[
                { callId: "ec1", name: "edit_file", args: { path: "src/socket.ts" }, status: "done", summary: "+3 -3 src/socket.ts", diff: SAMPLE_EDIT_DIFF },
                { callId: "ec2", name: "write_file", args: { path: "src/clamp.ts" }, status: "done", summary: "new file +4 -0 src/clamp.ts", diff: SAMPLE_NEW_FILE_DIFF },
                { callId: "ec3", name: "edit_file", args: { path: "src/old.ts" }, status: "done", summary: "done" },
              ]}
            />
          </div>
        </div>
      </section>
      </Only>

      <Only id="thinking">
      <section className="mt-6" id={anchor("Thinking")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Thinking</h3>
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
          {THINKING_CASES.map(({ label, message, shown }) => (
            <div key={label} aria-label={`Thinking, ${label}`} role="group" className="flex flex-col gap-1">
              <p className="font-mono text-xs text-faint">{label}</p>
              <TranscriptMessages chat={{ messages: [message], error: null, notice: null }} thinkingShown={shown} />
            </div>
          ))}
        </div>
      </section>
      </Only>

      <Only id="cost">
      <section className="mt-6" id={anchor("Cost")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Cost</h3>
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
          {COST_CASES.map(({ label, message }) => (
            <div key={label} aria-label={`Cost, ${label}`} role="group" className="flex flex-col gap-1">
              <p className="font-mono text-xs text-faint">{label}</p>
              <TranscriptMessages chat={{ messages: [message], error: null, notice: null }} />
            </div>
          ))}
        </div>
      </section>
      </Only>

      <Only id="routed-answers">
      <section className="mt-6" id={anchor("Routed answers")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Routed answers</h3>
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
          {ROUTED_CASES.map(({ label, message, route }) => (
            <div key={label} aria-label={`Routed, ${label}`} role="group" className="flex flex-col gap-1">
              <p className="font-mono text-xs text-faint">{label}</p>
              <TranscriptMessages chat={{ messages: [message], error: null, notice: null, route: { mode: "auto", last: null, ...route } }} session={ROUTED_SESSION} />
            </div>
          ))}
        </div>
      </section>
      </Only>

      <Only id="cut-reply">
      <section className="mt-6" id={anchor("Cut reply")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Cut reply</h3>
        <div className="rounded-lg border border-line bg-bg p-4">
          <TranscriptMessages chat={{ messages: [CUT_REPLY], error: null, notice: null }} />
        </div>
      </section>
      </Only>

      <Only id="writing-a-file">
      <section className="mt-6" id={anchor("Writing a file")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Writing a file</h3>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <WritingRow writing={{ name: "write_file", path: "tests/test_fetch.py", lines: 14, chars: 420 }} />
          <WritingRow writing={{ name: "write_file", path: null, lines: 0, chars: 0 }} />
          <WritingRow writing={{ name: "edit_file", path: "src/fetch.py", lines: 6, chars: 180 }} />
        </div>
      </section>
      </Only>

      <Only id="plan-card">
      <section className="mt-6" id={anchor("Plan card")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Plan card</h3>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
          <PlanCardView title="retry with backoff" steps={PLAN_DEMO_STEPS} actions={{ onBuild: async () => {}, onChange: () => {} }} />
          <PlanCardView title="retry with backoff" steps={PLAN_DEMO_STEPS} actions={null} />
        </div>
      </section>
      </Only>

      <Only id="diff">
      <DiffDemo />
      </Only>

      <Only id="todo-list">
      <TodoListDemo />
      </Only>

      <Only id="workbench">
      <WorkbenchDemo />
      </Only>
      <Only id="batch-card">
      <BatchCardDemo />
      </Only>
      <Only id="steps-tab">
      <StepsTabDemo />
      </Only>
      <Only id="runs-helpers">
      <LeadRunDemo />
      </Only>
      <Only id="helper-panel">
      <HelperPanelDemo />
      </Only>
      <Only id="helper-banner-receipt">
      <HelperBannerDemo />
      </Only>

      <Only id="changes-tab">
      <ChangesDemo />
      </Only>

      <Only id="changes-by-turn">
      <TurnsDemo />
      </Only>

      <Only id="files-tab">
      <FilesDemo />
      </Only>

      <Only id="checks-strip">
      <ChecksStripDemo />
      </Only>

      <Only id="checks-tab">
      <ChecksTabDemo />
      </Only>

      <Only id="checks-question">
      <ChecksQuestionDemo />
      </Only>

      <Only id="commit-dialog">
      <CommitDialogDemo theme={theme} />
      </Only>

      <Only id="undo-dialogs">
      <UndoDialogsDemo theme={theme} />
      </Only>

      <Only id="command-palette-and-keys">
      <section className="mt-6" id={anchor("Command palette and keys")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Command palette and keys</h3>
        <PaletteDemo theme={theme} />
      </section>
      </Only>

      <Only id="model-dialog">
      <section className="mt-6" id={anchor("Model dialog")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Model dialog</h3>
        <ModelDialogDemo theme={theme} />
      </section>
      </Only>

      <Only id="model-list">
      <section className="mt-6" id={anchor("Model list")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Model list</h3>
        <ModelListDemo />
      </section>
      </Only>

      <Only id="dialog-popover-menu-tooltip">
      <Group title="Dialog, popover, menu, tooltip">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>It cannot be undone.</DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Keep it</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button kind="danger">Delete</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Open popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p>The folder is where golem runs.</p>
            <PopoverClose asChild>
              <Button size="sm" className="mt-3">Got it</Button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
        <Menu>
          <MenuTrigger asChild>
            <Button>
              Open menu <ChevronDownIcon />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Session</MenuLabel>
            <MenuItem>Rename</MenuItem>
            <MenuItem>Fork</MenuItem>
            <MenuSeparator />
            <MenuItem disabled>Archive</MenuItem>
            <MenuItem>Delete</MenuItem>
          </MenuContent>
        </Menu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button kind="ghost">Hover or focus me</Button>
          </TooltipTrigger>
          <TooltipContent>A tooltip</TooltipContent>
        </Tooltip>
      </Group>
      </Only>
    </section>
  );
}

function Panel({ theme, prefix }: { theme: "slip" | "kiln"; prefix: string }) {
  return (
    <AnchorPrefix.Provider value={prefix}>
      <PanelBody theme={theme} prefix={prefix} />
    </AnchorPrefix.Provider>
  );
}

type View = "both" | "slip" | "kiln";

const VIEWS: { value: View; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "slip", label: "Slip" },
  { value: "kiln", label: "Kiln" },
];

/** `?theme=slip` or `?theme=kiln` shows one theme; anything else shows both. */
function initialView(): View {
  const asked = new URLSearchParams(location.search).get("theme");
  return asked === "slip" || asked === "kiln" ? asked : "both";
}

/** Every primitive in both themes, side by side, or one at a time. Each section has an id: `#trace`, `#approval`. */
export function Gallery({ only }: { only?: string } = {}) {
  const [view, setView] = useState<View>(initialView);

  // The sections are drawn after the browser looked for the hash, so scroll to it once they are.
  // Fonts and lazily loaded code highlighting keep growing the sections above it for a moment,
  // so stay on the section while the page resizes, until the reader scrolls or two seconds pass.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    const pin = () => target.scrollIntoView();
    pin();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(pin);
    observer.observe(document.body);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const event of ["wheel", "touchstart", "keydown"]) window.removeEventListener(event, stop);
    };
    const timer = setTimeout(stop, 2000);
    for (const event of ["wheel", "touchstart", "keydown"]) window.addEventListener(event, stop, { once: true });
    return stop;
  }, []);

  return (
    <main className="min-h-screen bg-bg p-4 text-ink sm:p-8">
      <h1 className="font-prose text-2xl">Gallery</h1>
      <p className="mt-2 text-muted">Every primitive, in slip and kiln.</p>
      <ThemeSwitch />
      <div role="group" aria-label="Themes shown" className="mt-3 flex items-center gap-2">
        <span className="text-sm text-muted">Show</span>
        {VIEWS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm outline-offset-2 outline-clay focus-visible:outline-2 aria-pressed:bg-clay-soft aria-pressed:text-clay-ink"
          >
            {label}
          </button>
        ))}
      </div>
      <OnlySection.Provider value={only}>
        <div className={view === "both" ? "mt-6 grid gap-4 md:grid-cols-2" : "mt-6 grid gap-4"}>
          {view !== "kiln" && <Panel theme="slip" prefix="" />}
          {view !== "slip" && <Panel theme="kiln" prefix={view === "both" ? "kiln-" : ""} />}
        </div>
      </OnlySection.Provider>
    </main>
  );
}
