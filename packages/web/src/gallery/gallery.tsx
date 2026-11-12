import { COMMANDS, noPastes, pickerGroups, withModelChoices, withSkillChoices, type TodoItem } from "@golem/view";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog.tsx";
import { GOLEM_STATE_LABEL, type GolemState } from "../ui/golem-state.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { ChevronDownIcon, CloseIcon, CopyIcon, PlusIcon, SearchIcon, SendIcon, StopIcon } from "../ui/icons.tsx";
import { Input } from "../ui/input.tsx";
import { Kbd } from "../ui/kbd.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { PixelGolem } from "../ui/pixel-golem.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { StatusDot } from "../ui/status-dot.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import { ConnectionScreen } from "../features/connection/connection-screen.tsx";
import { connectionScreen } from "../features/connection/connection-screen.ts";
import { ToolLine, TranscriptMessages } from "../features/chat/index.ts";
import { SAMPLE_CHAT, SAMPLE_TOOLS, THINKING_CASES, TURN_CHAT } from "../features/chat/sample.ts";
import { ApprovalBar } from "../features/approval/index.ts";
import { ANSWERED, PENDING_EDIT, PENDING_SHELL } from "../features/approval/sample.ts";
import { DiffModeSwitch, DiffView } from "../features/diff/index.ts";
import { SAMPLE_EDIT_DIFF, SAMPLE_LONG_LINE_DIFF, SAMPLE_NEW_FILE_DIFF } from "../features/diff/sample.ts";
import { Drawer, TodoList } from "../features/drawer/index.ts";
import { Composer, ContextChipView, DockView, Meter, ModeChipView, TuneChipView } from "../features/composer/index.ts";
import { createHistory } from "../features/composer/history.ts";
import { CommandsDialog } from "../features/composer/help-dialog.tsx";
import { HomeView, NewSessionModelChipView, SessionTitle } from "../features/shell/index.ts";
import { FolderBrowserView } from "../features/shell/folder-browser.tsx";
import { CommandPaletteView, KeysDialog } from "../features/palette/index.ts";
import { ModelDialogView, ModelList, withActivePulls, type ModelDialogViewProps, type ModelListNote } from "../features/models/index.ts";
import { sampleTry, sampleTuneBackend } from "../features/models/sample-tune.ts";
import { SetupDialogView } from "../features/setup/index.ts";
import { FinishSetupStripView, WelcomeView } from "../features/welcome/index.ts";
import { WELCOME_CASES } from "../features/welcome/sample.ts";
import { SpanDetail, TraceSummary, TraceTree } from "../features/trace/index.ts";
import { APPROVAL_DETAIL, APPROVAL_TRACE, CUT_LIKELY_DETAIL, CUT_MIDDLE_DETAIL, CUT_YES_DETAIL, FULL_DETAIL, MODEL_DETAIL, NO_PROMPT_DETAIL, NUM_CTX_DETAIL, OLD_DETAIL, SECTIONS_DETAIL, TOOL_DETAIL, UNKNOWN_WINDOW_DETAIL, FAILED_TRACE, GROWING_TRACE, LONG_TRACE, OLD_TRACE, SHORT_TRACE } from "../features/trace/sample.ts";
import type { TraceRunSpan, TraceSpanResult } from "../store/trace.ts";
import { FORM_CASES, SETUP_CASES } from "../features/setup/sample.ts";
import { AddKey, SetupFormView } from "../features/setup/setup-form.tsx";
import { panelView } from "../features/setup/setup-ui.ts";
import { PullStatusView, pullSummary } from "../features/models/index.ts";
import { NO_OLLAMA_LISTING, OLLAMA_DOWN_LISTING, SAMPLE_LISTING, SAMPLE_PULLS, THINKING_LISTING } from "../features/models/sample.ts";
import { CloseSessionDialog, RenameField, SidebarView } from "../features/sessions/index.ts";
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

const NOW = Date.parse("2026-11-01T12:00:00Z");

function fakeSession(
  id: string,
  title: string | null,
  cwd: string | null,
  status: SessionSummary["status"],
  minutesAgo: number,
  forkedFrom?: string,
): SessionSummary {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  const base = { session_id: id, created_at: at, updated_at: at, last_seq: 1, model_profile: "default", status, cwd, title };
  return forkedFrom === undefined ? base : { ...base, forked_from: forkedFrom };
}

const SESSIONS: SessionSummary[] = [
  fakeSession("a", "UTF-8 split in the socket client", "/Users/you/repos/golem", "waiting", 0),
  fakeSession("b", "ADR-028: the web gateway", "/Users/you/repos/golem", "running", 2),
  fakeSession("c", "Invoke /ship from the composer", "/Users/you/repos/golem", "idle", 75),
  fakeSession("h", "Same fix, as a table", "/Users/you/repos/golem", "idle", 30, "a"),
  fakeSession("i", "Table with a decoder test", "/Users/you/repos/golem", "idle", 20, "h"),
  fakeSession("j", "Gateway ADR, shorter", "/Users/you/repos/golem", "idle", 90, "gone"),
  fakeSession("d", "Weekday PR digest, draft", "/Users/you/notes", "idle", 60 * 26),
  fakeSession("e", null, "/Users/you/notes", "idle", 60 * 24 * 12),
  fakeSession("f", "A scratch session", null, "idle", 60 * 24 * 5),
  fakeSession("g", "Closed, so hidden", "/Users/you/notes", "closed", 5),
];

const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.4.0" };

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

/** The id for a section, so a link such as `/gallery/#trace` reaches it. */
function useAnchor(): (title: string) => string {
  const prefix = useContext(AnchorPrefix);
  return (title) => prefix + slug(title);
}

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
}: {
  size?: "dock" | "large";
  busy?: boolean;
  disabledReason?: string | null;
  /** The draft to start with. A slash draft opens the suggestions when `commands` is set. */
  initial?: string;
  commands?: typeof GALLERY_COMMANDS;
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
      commands={commands}
      busy={busy}
      onStop={() => {}}
      disabledReason={disabledReason}
    />
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

/** The todo list in its states, and the drawer frame at a fixed height. */
function DrawerDemo({ theme }: { theme: string }) {
  const anchor = useAnchor();
  const id = useId();
  return (
    <section className="mt-6" id={anchor("Drawer")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Drawer</h3>
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
        <div className="flex h-96 overflow-hidden rounded-lg border border-line">
          <Drawer id={id} label={`Details, ${theme}`} todos={SAMPLE_TODOS} floating={false} onClose={() => {}} />
        </div>
      </div>
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

/** The approval bar, waiting in the dock, and the chips it leaves in the steps. */
function ApprovalDemo() {
  const anchor = useAnchor();
  return (
    <section className="mt-6" id={anchor("Approval")}>
      <h3 className="mb-2 font-mono text-xs text-faint">Approval</h3>
      <div className="flex flex-col gap-4">
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
            actions={{ use: none, setDefault: none, pull: none, stop: none, remove: none, refresh: none }}
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

/** The setup window in each state the page draws it. */
function SetupDemo({ theme }: { theme: string }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-bg p-4">
      {SETUP_CASES.map(({ label, ui, ctx }) => (
        <div key={label}>
          <Button onClick={() => setShown(label)}>
            {`Setup, ${label}`}
            <span className="sr-only">, {theme}</span>
          </Button>
          <SetupDialogView
            open={shown === label}
            onClose={() => setShown(null)}
            window={ui.window}
            view={panelView(ui, ctx)}
            pull={ui.model.phase === "downloading" ? ctx.pulls.active.get(ui.model.ref) : undefined}
            onKey={() => {}}
            onChoose={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

/** Settings → Setup: the cards with their fixes, and the key command under them. */
function SetupFormDemo() {
  return (
    <div className="flex flex-col gap-4">
      {FORM_CASES.map(({ label, rows, actions, providers }) => (
        <div key={label} className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-4">
          <span className="font-mono text-xs text-faint">{label}</span>
          <SetupFormView
            rows={rows}
            actions={actions}
            onButton={() => {}}
            onCancelInstall={() => {}}
            onNavigate={() => {}}
            hasPage={() => false}
          />
          <AddKey providers={providers} actions={actions} onCheck={() => {}} />
        </div>
      ))}
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

function SummaryDemo({ label, runs }: { label: string; runs: TraceRunSpan[] }) {
  return (
    <figure className="w-full">
      <figcaption className="mb-1 font-mono text-xs text-faint">{label}</figcaption>
      <div className="flex items-center rounded-md border border-line bg-bg px-4 py-2">
        <TraceSummary runs={runs} />
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

      <Group title="Trace">
        <SummaryDemo label="Summary, context growing" runs={GROWING_TRACE} />
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

      <Group title="Icon button">
        <IconButton label="New session"><PlusIcon /></IconButton>
        <IconButton label="Close"><CloseIcon /></IconButton>
        <IconButton label="More"><ChevronDownIcon /></IconButton>
        <IconButton label="Send"><SendIcon /></IconButton>
        <IconButton label="Stop"><StopIcon /></IconButton>
        <IconButton label="Copy"><CopyIcon /></IconButton>
        <IconButton label="Search"><SearchIcon /></IconButton>
        <IconButton label="Disabled" disabled><CopyIcon /></IconButton>
      </Group>

      <section className="mt-6" id={anchor("Connection screens")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Connection screens</h3>
        <div className="grid gap-4">
          {SNAPSHOTS.map((snapshot) => {
            const spec = connectionScreen(snapshot);
            return spec ? (
              <div key={`${spec.kind}-${spec.tag}`} className="rounded-lg border border-line bg-bg">
                <ConnectionScreen spec={spec} headingLevel="h4" />
              </div>
            ) : null;
          })}
        </div>
      </section>

      <section className="mt-6" id={anchor("Sidebar")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Sidebar</h3>
        <div className="h-96 overflow-hidden rounded-lg border border-line">
          <SidebarView
            label={`Sessions, ${theme}`}
            sessions={SESSIONS}
            selectedId="b"
            connection={CONNECTED}
            now={NOW}
            onNavigate={() => {}}
            actions={{ rename: () => Promise.resolve(), close: () => Promise.resolve() }}
            onSearch={() => {}}
          />
        </div>
      </section>

      <section className="mt-6" id={anchor("Folder browser")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Folder browser</h3>
        <FolderBrowserDemo theme={theme} />
      </section>

      <section className="mt-6" id={anchor("Setup form")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Setup form</h3>
        <SetupFormDemo />
      </section>

      <section className="mt-6" id={anchor("Welcome page")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Welcome page</h3>
        <WelcomeDemo />
      </section>

      <section className="mt-6" id={anchor("Download row")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Download row</h3>
        <DownloadRowDemo />
      </section>

      <section className="mt-6" id={anchor("Session title, rename, and close")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Session title, rename, and close</h3>
        <SessionActionsDemo theme={theme} />
      </section>

      <section className="mt-6" id={anchor("Empty screen")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Empty screen</h3>
        <div className="flex h-96 flex-col rounded-lg border border-line bg-bg">
          <HomeView
            headingLevel="h4"
            folder="/Users/you/repos/golem"
            folders={["/Users/you/repos/golem", "/Users/you/notes"]}
            onChange={() => {}}
            composer={<DemoComposer size="large" />}
            modelChip={<NewSessionModelChipView label={{ kind: "default", text: "Gemma 4 E4B" }} onOpen={() => {}} />}
          />
        </div>
        <div aria-label="Empty screen, setup left" role="group" className="mt-2 flex h-96 flex-col rounded-lg border border-line bg-bg">
          <HomeView
            headingLevel="h4"
            folder="/Users/you/repos/golem"
            folders={["/Users/you/repos/golem"]}
            onChange={() => {}}
            notice={<FinishSetupStripView onFinish={() => {}} />}
            composer={<DemoComposer size="large" />}
            modelChip={<NewSessionModelChipView label={{ kind: "none" }} onOpen={() => {}} />}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-line bg-bg p-4">
          <NewSessionModelChipView label={{ kind: "default", text: "Gemma 4 E4B" }} onOpen={() => {}} />
          <NewSessionModelChipView label={{ kind: "pick", text: "Qwen3 8B" }} onOpen={() => {}} />
          <NewSessionModelChipView label={{ kind: "none" }} onOpen={() => {}} />
        </div>
      </section>

      <section className="mt-6" id={anchor("Dock")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Dock</h3>
        <div className="grid gap-4 rounded-lg border border-line bg-bg p-4">
          <DockView busy={false} meter={<Meter state="idle" runStartedAt={null} />} composer={<DemoComposer />} />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} aside={<ContextChipView used={32000} window={128000} onOpen={() => {}} />} />}
            composer={<DemoComposer />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} aside={<ContextChipView used={110000} window={128000} onOpen={() => {}} />} />}
            composer={<DemoComposer />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} aside={<ContextChipView used={125000} window={128000} onOpen={() => {}} />} />}
            composer={<DemoComposer />}
          />
          <DockView
            busy={false}
            meter={<Meter state="idle" runStartedAt={null} aside={<ContextChipView used={1300} window={16384} windowEstimated onOpen={() => {}} />} />}
            composer={<DemoComposer />}
          />
          <DockView
            busy={false}
            meter={
              <Meter
                state="idle"
                runStartedAt={null}
                aside={
                  <span className="flex items-center gap-2">
                    <TuneChipView text="temp 0.2 · top_p 0.9" onOpen={() => {}} />
                    <ContextChipView used={32000} window={128000} onOpen={() => {}} />
                  </span>
                }
              />
            }
            composer={<DemoComposer />}
          />
          <DockView
            busy={false}
            meter={
              <Meter
                state="idle"
                runStartedAt={null}
                aside={
                  <span className="flex items-center gap-2">
                    <ModeChipView own="autopilot" fallback="balanced" onSelect={() => {}} />
                    <ContextChipView used={32000} window={128000} onOpen={() => {}} />
                  </span>
                }
              />
            }
            composer={<DemoComposer />}
          />
          <div aria-label="Mode chips" role="group" className="flex flex-wrap gap-2">
            <ModeChipView own="careful" fallback="balanced" onSelect={() => {}} />
            <ModeChipView own={null} fallback="balanced" onSelect={() => {}} />
          </div>
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

      <ApprovalDemo />

      <Group title="Input, textarea">
        <Input aria-label={`Name, ${theme}`} placeholder="Name" />
        <Input aria-label={`Disabled name, ${theme}`} placeholder="Disabled" disabled />
        <Input aria-label={`Folder, ${theme}`} defaultValue="/nowhere" aria-invalid="true" />
        <Textarea aria-label={`Message, ${theme}`} placeholder="Message golem" />
        <Textarea aria-label={`Bad message, ${theme}`} defaultValue="Too long" aria-invalid="true" />
      </Group>

      <Group title="Card">
        <Card>
          <p className="text-sm">A card holds one thing.</p>
          <p className="mt-1 text-xs text-muted">Surface, a soft shadow, and a large radius.</p>
        </Card>
      </Group>

      <Group title="Badge">
        <Badge>neutral</Badge>
        <Badge tone="clay">clay</Badge>
        <Badge tone="allow">allow</Badge>
        <Badge tone="deny">deny</Badge>
        <Badge tone="wait">wait</Badge>
      </Group>

      <Group title="Kbd">
        <Kbd>⌘ K</Kbd>
        <Kbd>⇧ ↵</Kbd>
      </Group>

      <Group title="Status dot">
        {STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-2 text-sm">
            <StatusDot state={state} />
            <span aria-hidden="true" className="font-mono text-xs text-muted">{GOLEM_STATE_LABEL[state]}</span>
          </span>
        ))}
      </Group>

      <Group title="Pixel golem">
        {STATES.map((state) => (
          <PixelGolem key={state} state={state} showLabel />
        ))}
        <PixelGolem state="idle" size="sm" />
        <PixelGolem state="idle" size="lg" />
      </Group>

      <Group title="Tab icon and title">
        {STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-2 text-sm">
            <img src={faviconHref(state)} alt={`golem tab icon · ${GOLEM_STATE_LABEL[state]}`} className="size-4" />
            <span className="font-mono text-xs text-muted">{tabTitle(state, "Fix the login bug")}</span>
          </span>
        ))}
      </Group>

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

      <section className="mt-6" id={anchor("Turn")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Turn</h3>
        <div className="flex flex-col gap-3">
          {(["normal", "verbose", "quiet"] as const).map((detail) => (
            <div key={detail} aria-label={`A turn with four tool steps, ${detail}`} role="group" className="flex flex-col gap-6 rounded-lg border border-line bg-bg p-4">
              <p className="font-mono text-xs text-faint">{detail}</p>
              <TranscriptMessages chat={TURN_CHAT} detail={detail} />
            </div>
          ))}
        </div>
      </section>

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

      <DiffDemo />

      <DrawerDemo theme={theme} />

      <section className="mt-6" id={anchor("Command palette and keys")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Command palette and keys</h3>
        <PaletteDemo theme={theme} />
      </section>

      <section className="mt-6" id={anchor("Model dialog")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Model dialog</h3>
        <ModelDialogDemo theme={theme} />
      </section>

      <section className="mt-6" id={anchor("Model list")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Model list</h3>
        <ModelListDemo />
      </section>

      <section className="mt-6" id={anchor("Setup window")}>
        <h3 className="mb-2 font-mono text-xs text-faint">Setup window</h3>
        <SetupDemo theme={theme} />
      </section>

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
export function Gallery() {
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
      <div className={view === "both" ? "mt-6 grid gap-4 md:grid-cols-2" : "mt-6 grid gap-4"}>
        {view !== "kiln" && <Panel theme="slip" prefix="" />}
        {view !== "slip" && <Panel theme="kiln" prefix={view === "both" ? "kiln-" : ""} />}
      </div>
    </main>
  );
}
