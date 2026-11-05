<script setup lang="ts">
// The system on one machine, as a map you can use: click a part to see what it does and
// which chapter explains it, or follow one message through every part, hop by hop.
// Colours are golem's tokens, so slip and kiln both work. Under reduced motion the dot
// does not move: each step only lights its parts.
import { withBase } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

/** Plain text with `code` spans, as HTML. Everything else is escaped. */
const rich = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

type Part = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  about: string;
  code?: string;
  link?: string;
  chapter?: string;
};

const parts: Part[] = [
  {
    id: "tui", x: 32, y: 76, w: 164, h: 48, title: "TUI", sub: "golem, in a terminal",
    about: "The chat in your terminal. It sends commands and draws the events it gets back. It holds no model memory, so you can close it while a run goes on.",
    code: "packages/tui/", link: "/architecture/tui", chapter: "The terminal app",
  },
  {
    id: "cli", x: 32, y: 140, w: 164, h: 48, title: "golem command", sub: "status, skills, config",
    about: "The same client library, one command at a time: `golem status`, `golem skills`, `golem config show`. It also installs and restarts the daemon.",
    code: "packages/cli/", link: "/guide/commands", chapter: "Commands",
  },
  {
    id: "web", x: 32, y: 204, w: 164, h: 44, title: "web UI", sub: "a browser tab",
    about: "The chat in a browser, opened by `golem web`. It speaks the same protocol, through the gateway, over a WebSocket.",
    code: "packages/web/", link: "/architecture/web", chapter: "The web UI",
  },
  {
    id: "gateway", x: 32, y: 262, w: 164, h: 44, title: "gateway", sub: "golem web, 127.0.0.1",
    about: "golem's one program that listens on a port. It lets in only the page `golem web` opened, passes protocol lines through unchanged, and refuses anything a browser should never send (ADR-028).",
    code: "packages/gateway/", link: "/architecture/web#how-golem-does-it", chapter: "The web UI",
  },
  {
    id: "socket", x: 232, y: 76, w: 80, h: 230, title: "socket", sub: "golem.sock",
    about: "A Unix socket at `~/.golem/run/golem.sock`, mode `0600`: only your user can open it, and that is the login. Each line is one JSON-RPC 2.0 object. No network port is opened.",
    code: "golem/server/", link: "/architecture/daemon", chapter: "The daemon",
  },
  {
    id: "server", x: 346, y: 76, w: 298, h: 44, title: "Protocol server", sub: "one JSON line, one command",
    about: "Reads one line at a time, checks it against the protocol models, runs the command, and queues the reply and the events of attached sessions for that connection.",
    code: "golem/server/handlers.py", link: "/architecture/protocol", chapter: "The protocol",
  },
  {
    id: "sessions", x: 346, y: 136, w: 298, h: 44, title: "Sessions", sub: "runs, the event log, fan-out",
    about: "One chat each, with an id and a project folder. A run is one answer. Every event is numbered by `seq` and written to `golem.db` before any client sees it, so a client that reconnects reads what it missed.",
    code: "golem/sessions/", link: "/architecture/sessions", chapter: "Sessions that survive",
  },
  {
    id: "graph", x: 346, y: 196, w: 190, h: 44, title: "Graph runtime", sub: "the agent loop",
    about: "LangGraph, called as a library inside the daemon: call the model, run the tools it asks for, call it again, until it answers. Its memory is the checkpoint.",
    code: "golem/graphs/chat.py", link: "/architecture/agent-loop", chapter: "The agent loop",
  },
  {
    id: "router", x: 550, y: 196, w: 94, h: 44, title: "Router", sub: "name → model",
    about: "Resolves a session's model, a profile name or `provider/model`, to a chat model: Anthropic, OpenAI, an OpenAI-compatible API, or Ollama. It finds the key, and golem starts Ollama when a local model needs it.",
    code: "golem/models/", link: "/architecture/models", chapter: "Talking to models",
  },
  {
    id: "prompt", x: 346, y: 262, w: 130, h: 44, title: "System prompt", sub: "built per call",
    about: "Built for each model call from its sections, put in front of the history, and never stored. Its one section today holds the pinned skills.",
    code: "golem/graphs/prompt.py", link: "/architecture/context", chapter: "Context",
  },
  {
    id: "skills", x: 346, y: 322, w: 130, h: 44, title: "Skills", sub: "SKILL.md folders",
    about: "The skills a session's folder sees: the project's, then yours. The first working one wins a name. Run one with `/name`, or pin it for the chat.",
    code: "golem/skills/", link: "/architecture/skills", chapter: "Skills",
  },
  {
    id: "tools", x: 514, y: 262, w: 130, h: 44, title: "Tools", sub: "files, shell, git, web",
    about: "Plain Python functions with a typed argument model. The graph offers them to the model and runs the calls in its tools node. Long output becomes an artifact.",
    code: "golem/tools/", link: "/architecture/tools", chapter: "Tools",
  },
  {
    id: "permissions", x: 514, y: 322, w: 130, h: 44, title: "Permissions", sub: "allow, ask, deny",
    about: "Rules from the project, from you, then the defaults, checked before every tool call. The first match decides. An ask pauses the run until you answer, across a restart.",
    code: "golem/permissions/", link: "/architecture/permissions", chapter: "Permissions",
  },
  {
    id: "sandbox", x: 514, y: 376, w: 130, h: 40, title: "Sandbox", sub: "sandbox-exec",
    about: "`shell` and the git tools run under `sandbox-exec`: writes only in the project and temp folders, no network, no secret folders, no keys in the environment.",
    code: "golem/tools/sandbox.py", link: "/architecture/sandboxes", chapter: "Sandboxes",
  },
  {
    id: "model", x: 696, y: 76, w: 168, h: 56, title: "Model API", sub: "Anthropic, OpenAI, Ollama",
    about: "The only part that may leave your machine: HTTPS to a hosted provider, or plain HTTP to Ollama or another local server. Only the daemon ever calls it.",
    link: "/guide/models", chapter: "Models",
  },
  {
    id: "mcp", x: 696, y: 160, w: 168, h: 56, title: "MCP servers", sub: "child processes, HTTP",
    about: "Servers from `[mcp.<name>]` in your config. Their tools join the session's tools as `mcp__<server>__<tool>`, ask before every call, and reach the model marked as data. A server that exits is restarted with backoff.",
    code: "golem/mcp/", link: "/guide/mcp", chapter: "MCP servers",
  },
  {
    id: "launchd", x: 696, y: 300, w: 168, h: 48, title: "launchd", sub: "starts it, restarts it",
    about: "Starts the daemon when you log in and again after a crash. Closing every client does not stop it, so a run can finish or wait for your approval with no window open.",
    code: "golem/launchd.py", link: "/install", chapter: "Install",
  },
  {
    id: "golemdb", x: 32, y: 368, w: 264, h: 36, title: "golem.db", sub: "the event log, sessions, runs",
    about: "golem's own SQLite file: every event, numbered by `seq`, and the sessions and runs tables derived from them in the same transaction. Long tool output is kept here as artifacts.",
    code: "golem/store/", link: "/architecture/sessions#the-event-log", chapter: "Sessions that survive",
  },
  {
    id: "ckpt", x: 32, y: 414, w: 264, h: 36, title: "checkpoints.db", sub: "the model's memory",
    about: "Written by LangGraph's SQLite checkpointer after each step. The thread id is the session id. It is a separate file, so it can be wiped without losing the event log.",
    link: "/architecture/sessions#files-on-disk", chapter: "Sessions that survive",
  },
  {
    id: "config", x: 32, y: 460, w: 264, h: 36, title: "config.toml", sub: "your settings and rules",
    about: "Your settings, models, rules, and MCP servers. A project's `.golem/` can add rules and servers, and the `GOLEM_` environment variables override both. Rules, models, skills, and servers are read again when the file changes.",
    link: "/guide/settings", chapter: "Settings",
  },
];

const byId = new Map(parts.map((p) => [p.id, p]));
const part = (id: string): Part => byId.get(id) as Part;

const wires: { from: string; to: string; d: string }[] = [
  { from: "tui", to: "socket", d: "M196 100 H232" },
  { from: "cli", to: "socket", d: "M196 164 H232" },
  { from: "web", to: "gateway", d: "M114 248 V262" },
  { from: "gateway", to: "socket", d: "M196 284 H232" },
  { from: "socket", to: "server", d: "M312 98 H346" },
  { from: "server", to: "sessions", d: "M495 120 V136" },
  { from: "sessions", to: "graph", d: "M441 180 V196" },
  { from: "graph", to: "router", d: "M536 218 H550" },
  { from: "router", to: "model", d: "M644 218 H670 V104 H696" },
  { from: "graph", to: "prompt", d: "M411 240 V262" },
  { from: "prompt", to: "skills", d: "M411 306 V322" },
  { from: "graph", to: "tools", d: "M525 240 V262" },
  { from: "tools", to: "permissions", d: "M579 306 V322" },
  { from: "permissions", to: "sandbox", d: "M579 366 V376" },
  { from: "tools", to: "mcp", d: "M644 284 H682 V188 H696" },
  { from: "launchd", to: "daemon", d: "M696 324 H660" },
  { from: "sessions", to: "golemdb", d: "M346 158 H338 V386 H296" },
  { from: "graph", to: "ckpt", d: "M495 240 V432 H296" },
];

type Step = { title: string; text: string; lit: string[]; path: string[]; link: string; chapter: string };

const steps: Step[] = [
  {
    title: "You press Enter",
    text: "The TUI sends one JSON line over the socket: `message.send`, with the session id and your text.",
    lit: ["tui", "socket"], path: ["tui", "socket"], link: "/architecture/protocol", chapter: "The protocol",
  },
  {
    title: "The daemon takes it",
    text: "The protocol server reads the line, checks it against the protocol models, and replies with a `run_id`. The work goes on without the client.",
    lit: ["socket", "server"], path: ["socket", "server"], link: "/architecture/daemon", chapter: "The daemon",
  },
  {
    title: "A run starts, and is written down",
    text: "The session starts a run. Your `message.completed` and `run.started` are written to `golem.db` first, then sent to every client attached to the session.",
    lit: ["server", "sessions", "golemdb"], path: ["server", "sessions", "golemdb"], link: "/architecture/sessions", chapter: "Sessions that survive",
  },
  {
    title: "The graph builds the context",
    text: "The graph loads the session's checkpoint, builds the system prompt for this one call with any pinned skills, and puts it in front of the history.",
    lit: ["sessions", "graph", "ckpt", "prompt", "skills"], path: ["sessions", "graph", "prompt", "skills"], link: "/architecture/context", chapter: "Context",
  },
  {
    title: "The model answers",
    text: "The router picks the provider for the session's model. The reply streams back, and every piece becomes a `message.delta` on the wire.",
    lit: ["graph", "router", "model"], path: ["graph", "router", "model"], link: "/architecture/models", chapter: "Talking to models",
  },
  {
    title: "It asks for a tool",
    text: "The reply asks for a tool: `tool.requested`. The rules decide allow, ask, or deny. An ask is `approval.needed`, and the run waits for you, with no task in memory.",
    lit: ["graph", "tools", "permissions"], path: ["graph", "tools", "permissions"], link: "/architecture/permissions", chapter: "Permissions",
  },
  {
    title: "The tool runs",
    text: "A file tool stays in the project folder, `shell` runs under `sandbox-exec`, and an MCP tool runs in its server. `tool.completed` goes into the history, and the model is called again.",
    lit: ["tools", "sandbox", "mcp"], path: ["permissions", "sandbox", "tools", "mcp"], link: "/architecture/tools", chapter: "Tools",
  },
  {
    title: "The answer, everywhere",
    text: "With no tool call left, the answer ends: `message.completed`, the checkpoint saved, `run.completed`. Every attached client got each event in `seq` order, so the TUI and a browser tab show the same chat.",
    lit: ["sessions", "server", "socket", "tui", "gateway", "web"], path: ["sessions", "server", "socket", "tui"], link: "/architecture/agent-loop", chapter: "The agent loop",
  },
];

const mode = ref<"explore" | "tour">("explore");
const selected = ref<string | null>(null);
const step = ref(0);
const playing = ref(false);
const dot = ref<{ x: number; y: number } | null>(null);

const current = computed(() => (selected.value ? part(selected.value) : null));
const lit = computed<Set<string>>(() => {
  if (mode.value === "tour") return new Set(steps[step.value]?.lit ?? []);
  return new Set(selected.value ? [selected.value] : []);
});
const litWire = (w: { from: string; to: string }): boolean =>
  mode.value === "tour"
    ? lit.value.has(w.from) && (lit.value.has(w.to) || w.to === "daemon")
    : selected.value !== null && (w.from === selected.value || w.to === selected.value);

function choose(id: string): void {
  mode.value = "explore";
  playing.value = false;
  selected.value = selected.value === id ? null : id;
}

const center = (id: string): { x: number; y: number } => {
  const p = part(id);
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
};

let frame = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const still = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function travel(path: string[]): void {
  cancelAnimationFrame(frame);
  dot.value = null;
  if (still() || path.length < 2) return;
  const points = path.map(center);
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - (points[i]?.x ?? 0), p.y - (points[i]?.y ?? 0)));
  const total = lengths.reduce((a, b) => a + b, 0);
  const started = performance.now();
  const tick = (now: number): void => {
    let along = Math.min((now - started) / 1400, 1) * total;
    let i = 0;
    while (i < lengths.length - 1 && along > (lengths[i] ?? 0)) along -= lengths[i++] ?? 0;
    const a = points[i] ?? points[0];
    const b = points[i + 1] ?? a;
    const t = (lengths[i] ?? 0) === 0 ? 1 : along / (lengths[i] ?? 1);
    if (a && b) dot.value = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (now - started < 1400) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

function go(n: number): void {
  mode.value = "tour";
  step.value = (n + steps.length) % steps.length;
  travel(steps[step.value]?.path ?? []);
}

function tour(): void {
  selected.value = null;
  playing.value = true;
  go(0);
}

watch(playing, (on) => {
  clearInterval(timer);
  if (on) {
    timer = setInterval(() => {
      if (step.value === steps.length - 1) playing.value = false;
      else go(step.value + 1);
    }, 5200);
  }
});

function onKey(event: KeyboardEvent): void {
  if (mode.value !== "tour") return;
  if (event.key === "ArrowRight") go(step.value + 1);
  if (event.key === "ArrowLeft") go(step.value - 1);
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  clearInterval(timer);
  cancelAnimationFrame(frame);
});
</script>

<template>
  <figure class="gm" :class="{ 'gm-touring': mode === 'tour' }">
    <div class="gm-bar" role="toolbar" aria-label="How to read the map">
      <button type="button" :aria-pressed="mode === 'explore'" @click="mode = 'explore'; playing = false">Explore</button>
      <button type="button" :aria-pressed="mode === 'tour'" @click="tour">Follow one message</button>
      <span class="gm-hint">{{ mode === "explore" ? "Click any part" : `Step ${step + 1} of ${steps.length} · ← →` }}</span>
    </div>

    <svg viewBox="0 0 880 512" role="group" aria-label="golem on one machine: clients, the socket, the daemon and its parts, the files in ~/.golem, and the model">
      <rect class="gm-frame" x="16" y="52" width="196" height="268" rx="8" />
      <text class="gm-group" x="28" y="44">CLIENTS · NODE</text>
      <rect class="gm-frame" x="330" y="52" width="330" height="372" rx="8" />
      <text class="gm-group" x="342" y="44">DAEMON · PYTHON, ONE PER USER</text>
      <rect class="gm-frame" x="16" y="340" width="296" height="166" rx="8" />
      <text class="gm-group" x="28" y="334">~/.golem</text>
      <text class="gm-group" x="696" y="44">OUTSIDE</text>

      <path v-for="w in wires" :key="w.from + w.to" class="gm-wire" :class="{ on: litWire(w) }" :d="w.d" />

      <g
        v-for="p in parts"
        :key="p.id"
        class="gm-part"
        :class="{ on: lit.has(p.id), dim: mode === 'tour' && !lit.has(p.id) }"
        role="button"
        tabindex="0"
        :aria-label="`${p.title}: ${p.sub}`"
        :aria-pressed="selected === p.id"
        @click="choose(p.id)"
        @keydown.enter.prevent="choose(p.id)"
        @keydown.space.prevent="choose(p.id)"
      >
        <rect :x="p.x" :y="p.y" :width="p.w" :height="p.h" rx="3" />
        <text class="gm-title" :x="p.x + 12" :y="p.y + (p.h > 60 ? 26 : p.h / 2 - 2)">{{ p.title }}</text>
        <text class="gm-sub" :x="p.x + 12" :y="p.y + (p.h > 60 ? 44 : p.h / 2 + 13)">{{ p.sub }}</text>
      </g>

      <rect v-if="dot" class="gm-dot" :x="dot.x - 6" :y="dot.y - 6" width="12" height="12" />
    </svg>

    <div class="gm-panel" aria-live="polite">
      <template v-if="mode === 'tour'">
        <div class="gm-kicker">{{ step + 1 }} · {{ steps[step]?.title }}</div>
        <p v-html="rich(steps[step]?.text ?? '')" />
        <div class="gm-steps">
          <button type="button" aria-label="Back" @click="go(step - 1)">←</button>
          <button
            v-for="(s, i) in steps"
            :key="s.title"
            type="button"
            class="gm-pip"
            :aria-label="`Step ${i + 1}: ${s.title}`"
            :aria-current="i === step"
            @click="playing = false; go(i)"
          />
          <button type="button" aria-label="Next" @click="playing = false; go(step + 1)">→</button>
          <button type="button" @click="playing = !playing">{{ playing ? "Pause" : "Play" }}</button>
          <a :href="withBase(steps[step]?.link ?? '/')">{{ steps[step]?.chapter }} →</a>
        </div>
      </template>
      <template v-else-if="current">
        <div class="gm-kicker">{{ current.title }} · {{ current.sub }}</div>
        <p v-html="rich(current.about)" />
        <p class="gm-meta">
          <code v-if="current.code">{{ current.code }}</code>
          <a v-if="current.link" :href="withBase(current.link)">{{ current.chapter }} →</a>
        </p>
      </template>
      <template v-else>
        <div class="gm-kicker">One daemon, any number of clients</div>
        <p>Everything runs on your machine, except the model when you pick a hosted one. Click a part to see what it does and which chapter explains it, or follow one message from your keyboard to the model and back.</p>
      </template>
    </div>

    <div class="gm-chips" aria-hidden="true">
      <button v-for="p in parts" :key="p.id" type="button" tabindex="-1" :class="{ on: selected === p.id }" @click="choose(p.id)">{{ p.title }}</button>
    </div>
  </figure>
</template>

<style scoped>
.gm {
  margin: 24px 0;
  padding: 16px;
  border: 1px solid var(--golem-line);
  border-radius: 12px;
  background: var(--golem-bg);
}
.gm svg {
  display: block;
  width: 100%;
  height: auto;
}
.gm-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  font-family: var(--golem-font-ui);
}
.gm-bar button,
.gm-steps button:not(.gm-pip),
.gm-chips button {
  font: 500 13px var(--golem-font-ui);
  color: var(--golem-ink);
  background: var(--golem-surface);
  border: 1px solid var(--golem-line);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}
.gm-bar button[aria-pressed="true"] {
  border-color: var(--golem-clay);
  color: var(--golem-clay-ink);
  background: var(--golem-clay-soft);
}
.gm-hint {
  margin-left: auto;
  font: 12px var(--golem-font-mono);
  color: var(--golem-faint);
}
.gm-frame {
  fill: none;
  stroke: var(--golem-line);
  stroke-dasharray: 4 4;
}
.gm-group {
  font: 11px var(--golem-font-mono);
  letter-spacing: 0.08em;
  fill: var(--golem-muted);
}
.gm-wire {
  fill: none;
  stroke: var(--golem-line);
  stroke-width: 1.3;
  transition: stroke 0.2s;
}
.gm-wire.on {
  stroke: var(--golem-clay);
  stroke-width: 2;
}
.gm-part {
  cursor: pointer;
  outline: none;
  transition: opacity 0.25s;
}
.gm-part rect {
  fill: var(--golem-surface);
  stroke: var(--golem-line);
  transition: stroke 0.2s, fill 0.2s;
}
.gm-part:hover rect,
.gm-part:focus-visible rect {
  stroke: var(--golem-clay);
}
.gm-part.on rect {
  fill: var(--golem-clay-soft);
  stroke: var(--golem-clay);
  stroke-width: 2;
}
.gm-part.dim {
  opacity: 0.45;
}
.gm-title {
  font: 600 14px var(--golem-font-ui);
  fill: var(--golem-ink);
}
.gm-sub {
  font: 11px var(--golem-font-ui);
  fill: var(--golem-faint);
}
.gm-dot {
  fill: var(--golem-clay);
  pointer-events: none;
}
.gm-panel {
  min-height: 132px;
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--golem-surface);
  border: 1px solid var(--golem-line);
}
.gm-panel p {
  margin: 0 0 8px;
  line-height: 1.6;
}
.gm-kicker {
  margin-bottom: 6px;
  font: 600 12px var(--golem-font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--golem-clay-ink);
}
.gm-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.gm-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.gm-steps a {
  margin-left: auto;
}
.gm-pip {
  width: 10px;
  height: 10px;
  padding: 0;
  border: 1px solid var(--golem-clay);
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
}
.gm-pip[aria-current="true"] {
  background: var(--golem-clay);
}
.gm-chips {
  display: none;
}
@media (max-width: 640px) {
  .gm {
    padding: 10px;
  }
  .gm-hint {
    display: none;
  }
  .gm-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .gm-chips button.on {
    border-color: var(--golem-clay);
    background: var(--golem-clay-soft);
  }
}
@media (prefers-reduced-motion: reduce) {
  .gm-part,
  .gm-wire {
    transition: none;
  }
}
</style>
