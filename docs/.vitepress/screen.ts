// A ```screen fence: a TUI screen, written as plain text, drawn as a terminal window.
//
// The text needs no markup. Each line is coloured by the marks golem's TUI already uses:
//
//   ✓ Service ── ● Engine ── ○ Model     the stepper, as pills
//   › On this Mac      private, free     the selected row, in clay; text after a wide gap is dim
//   ✓ done   ✗ failed   ! needs you      green, red, amber (! only at the start of a line)
//   ⠙ starting…   ███░░░   ❯ ••••▏      a spinner, a progress bar, a hidden key field
//   ───────────────                      a rule between the chat and the composer
//   Enter picks · ↑↓ move · Esc back     the last line, as hints with keys
//
// It stays a code block on GitHub, so the page still reads there.

export interface ScreenParts {
  /** Escaped HTML for the title bar. */
  title: string;
  /** Rendered inline markdown under the window, or "". */
  caption: string;
}

const KEYS = /^(Enter|Esc|↑↓|Tab|Space|q|r|x|Ctrl-[A-Z]|[a-z])(?=\s|$)/;
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠿]/;
const STEP = /([✓●○!–]) ([A-Z][a-z]+)/g;
const STATES: Record<string, string> = { "✓": "done", "●": "now", "○": "todo", "!": "attn", "–": "skip" };

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Marks inside a run of text that is already escaped. */
function marks(text: string): string {
  return text
    .replace(/(█+)(░*)/g, '<span class="s-bar"><span class="s-fill">$1</span>$2</span>')
    .replace(new RegExp(`(${SPINNER.source})`, "g"), '<span class="s-spin">$1</span>')
    .replace(/✓/g, '<span class="s-ok">✓</span>')
    .replace(/✗/g, '<span class="s-fail">✗</span>')
    .replace(/●/g, '<span class="s-clay">●</span>')
    .replace(/❯/g, '<span class="s-clay">❯</span>')
    .replace(/(•+)/g, '<span class="s-dim">$1</span>')
    .replace(/▏/g, '<span class="s-cursor">▏</span>');
}

function isStepper(line: string): boolean {
  return line.includes("──") && (line.match(STEP)?.length ?? 0) >= 2;
}

function stepper(line: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const steps = [...line.matchAll(STEP)].map(
    ([, mark = "", name = ""]) => `<span class="s-step s-${STATES[mark] ?? "todo"}">${mark} ${name}</span>`,
  );
  return indent + steps.join('<span class="s-join">──</span>');
}

function isHint(line: string): boolean {
  return KEYS.test(line.trim()) && (line.includes(" · ") || /^\s*(Enter|Esc)\b/.test(line));
}

function hint(line: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const parts = line
    .trim()
    .split(" · ")
    .map((part) => {
      const key = KEYS.exec(part)?.[0];
      if (key === undefined) return `<span class="s-dim">${escape(part)}</span>`;
      return `<kbd>${escape(key)}</kbd><span class="s-dim">${escape(part.slice(key.length))}</span>`;
    });
  return `<span class="s-hint">${indent}${parts.join('<span class="s-dim"> · </span>')}</span>`;
}

function body(line: string): string {
  if (/^\s*─{5,}\s*$/.test(line)) return '<span class="s-rule"></span>';
  if (isStepper(line)) return stepper(line);
  const selected = /^(\s*)› (.*)$/.exec(line);
  const indent = selected ? selected[1]! : (/^\s*/.exec(line)?.[0] ?? "");
  let rest = selected ? selected[2]! : line.slice(indent.length);
  let lead = selected ? '<span class="s-clay">›</span> ' : "";
  if (!selected && rest.startsWith("! ")) {
    lead = '<span class="s-attn">!</span> ';
    rest = rest.slice(2);
  }
  // A wide gap splits a label from its detail, as the TUI's rows do.
  const gap = /^(\S.*?)( {2,})(\S.*)$/.exec(rest);
  const text = gap
    ? `${marks(escape(gap[1]!))}${gap[2]}<span class="s-dim">${marks(escape(gap[3]!))}</span>`
    : marks(escape(rest));
  const row = `${indent}${lead}${text}`;
  return selected ? `<span class="s-sel">${row}</span>` : row;
}

/** The figure for one screen. */
export function renderScreen(content: string, parts: ScreenParts): string {
  const lines = content.replace(/\s+$/, "").split("\n").map((line) => line.replace(/\s+$/, ""));
  const last = lines.length - 1;
  const html = lines.map((line, index) => (index === last && isHint(line) ? hint(line) : body(line))).join("\n");
  const bar =
    '<div class="screen-bar"><span class="screen-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
    `<span class="screen-title">${parts.title}</span></div>`;
  const caption = parts.caption ? `<figcaption class="screen-caption">${parts.caption}</figcaption>` : "";
  // v-pre: Vue compiles each page, and a screen may hold a {{ … }} of its own.
  return `<figure class="screen" v-pre>${bar}<pre class="screen-body">${html}\n</pre>${caption}</figure>\n`;
}
