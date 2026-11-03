import { noPastes, type TodoItem } from "@golem/view";
import { useId, useState, type ReactNode } from "react";
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
import { SAMPLE_CHAT, SAMPLE_TOOLS } from "../features/chat/sample.ts";
import { ApprovalCard } from "../features/approval/index.ts";
import { ANSWERED, PENDING_EDIT, PENDING_SHELL } from "../features/approval/sample.ts";
import { DiffModeSwitch, DiffView } from "../features/diff/index.ts";
import { SAMPLE_EDIT_DIFF, SAMPLE_LONG_LINE_DIFF, SAMPLE_NEW_FILE_DIFF } from "../features/diff/sample.ts";
import { Drawer, TodoList } from "../features/drawer/index.ts";
import { Composer, DockView, Meter } from "../features/composer/index.ts";
import { createHistory } from "../features/composer/history.ts";
import { HomeView } from "../features/shell/index.ts";
import { SidebarView } from "../features/sessions/index.ts";
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
): SessionSummary {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  return { session_id: id, created_at: at, updated_at: at, last_seq: 1, model_profile: "default", status, cwd, title };
}

const SESSIONS: SessionSummary[] = [
  fakeSession("a", "UTF-8 split in the socket client", "/Users/you/repos/golem", "waiting", 0),
  fakeSession("b", "ADR-028: the web gateway", "/Users/you/repos/golem", "running", 2),
  fakeSession("c", "Invoke /ship from the composer", "/Users/you/repos/golem", "idle", 75),
  fakeSession("d", "Weekday PR digest, draft", "/Users/you/notes", "idle", 60 * 26),
  fakeSession("e", null, "/Users/you/notes", "idle", 60 * 24 * 12),
  fakeSession("f", "A scratch session", null, "idle", 60 * 24 * 5),
  fakeSession("g", "Closed, so hidden", "/Users/you/notes", "closed", 5),
];

const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.4.0" };

const STATES: GolemState[] = ["idle", "thinking", "waiting", "failed", "offline"];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-xs text-faint">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

const galleryHistory = createHistory(() => null);

/** A composer with its draft in the component, so the gallery needs no page. */
function DemoComposer({
  size,
  busy = false,
  disabledReason = null,
}: {
  size?: "dock" | "large";
  busy?: boolean;
  disabledReason?: string | null;
}) {
  const [text, setText] = useState("");
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
      busy={busy}
      onStop={() => {}}
      disabledReason={disabledReason}
    />
  );
}

/** Every diff in both layouts, and the switch on its own. */
function DiffDemo() {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const samples = [
    ["An edit with two hunks", SAMPLE_EDIT_DIFF],
    ["A new file", SAMPLE_NEW_FILE_DIFF],
    ["A long line", SAMPLE_LONG_LINE_DIFF],
  ] as const;
  return (
    <section className="mt-6">
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
  const id = useId();
  return (
    <section className="mt-6">
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

/** A pending card whose editor is open, and closes on Cancel. */
function EditingDemo({ draft }: { draft?: string }) {
  const [editing, setEditing] = useState(true);
  return <ApprovalCard tool={PENDING_SHELL} pending editing={editing} draft={draft} onEdit={setEditing} onAnswer={() => {}} />;
}

/** The approval card, pending and answered. */
function ApprovalDemo() {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-xs text-faint">Approval</h3>
      <div className="flex flex-col gap-4">
        <ApprovalCard tool={PENDING_EDIT} pending onAnswer={() => {}} />
        <ApprovalCard tool={PENDING_SHELL} pending onAnswer={() => {}} />
        <div>
          <p className="mb-1 text-xs text-muted">Editing the arguments</p>
          <EditingDemo />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Editing the arguments, not valid JSON</p>
          <EditingDemo draft={'{\n  "command": "pnpm test",\n'} />
        </div>
        {ANSWERED.map(({ label, tool }) => (
          <div key={label}>
            <p className="mb-1 text-xs text-muted">{label}</p>
            <ApprovalCard tool={tool} pending={false} onAnswer={() => {}} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({ theme }: { theme: "slip" | "kiln" }) {
  return (
    <section data-theme={theme} aria-label={`${theme} theme`} className="rounded-lg border border-line bg-bg p-4 text-ink">
      <h2 className="font-prose text-xl">{theme}</h2>

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

      <section className="mt-6">
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

      <section className="mt-6">
        <h3 className="mb-2 font-mono text-xs text-faint">Sidebar</h3>
        <div className="h-96 overflow-hidden rounded-lg border border-line">
          <SidebarView
            label={`Sessions, ${theme}`}
            sessions={SESSIONS}
            selectedId="b"
            connection={CONNECTED}
            now={NOW}
            onNavigate={() => {}}
          />
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-mono text-xs text-faint">Empty screen</h3>
        <div className="flex h-96 flex-col rounded-lg border border-line bg-bg">
          <HomeView
            headingLevel="h4"
            folder="/Users/you/repos/golem"
            folders={["/Users/you/repos/golem", "/Users/you/notes"]}
            onChange={() => {}}
            composer={<DemoComposer size="large" />}
          />
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-mono text-xs text-faint">Dock</h3>
        <div className="grid gap-4 rounded-lg border border-line bg-bg p-4">
          <DockView busy={false} meter={<Meter state="idle" runStartedAt={null} />} composer={<DemoComposer />} />
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

      <section className="mt-6">
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

      <DiffDemo />

      <DrawerDemo theme={theme} />

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

/** Every primitive in both themes, side by side. Development only: open /gallery. */
export function Gallery() {
  return (
    <main className="min-h-screen bg-bg p-4 text-ink sm:p-8">
      <h1 className="font-prose text-2xl">Gallery</h1>
      <p className="mt-2 text-muted">Every primitive, in slip and kiln.</p>
      <ThemeSwitch />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Panel theme="slip" />
        <Panel theme="kiln" />
      </div>
    </main>
  );
}
