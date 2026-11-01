import type { ReactNode } from "react";
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
import type { ConnectionSnapshot } from "../store/connection.ts";
import { ThemeSwitch } from "../theme-switch.tsx";

const SNAPSHOTS: ConnectionSnapshot[] = [
  { state: { status: "connecting" }, daemonVersion: null },
  { state: { status: "unauthorized" }, daemonVersion: null },
  { state: { status: "rejected", reason: "protocol major mismatch: client 2, daemon 1" }, daemonVersion: null },
  { state: { status: "reconnecting", attempt: 4, delayMs: 2000, closeCode: 1013 }, daemonVersion: null },
  { state: { status: "reconnecting", attempt: 2, delayMs: 1000 }, daemonVersion: null },
  { state: { status: "closed", reason: "closed" }, daemonVersion: null },
];

const STATES: GolemState[] = ["idle", "thinking", "waiting", "failed", "offline"];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-xs text-faint">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
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
