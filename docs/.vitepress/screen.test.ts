import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { golemContainers } from "./containers.ts";
import { renderScreen } from "./screen.ts";

const md = new MarkdownIt();
golemContainers(md);

function screen(text: string): string {
  return renderScreen(text, { title: "T", caption: "" });
}

test("a screen fence is a window with its title, its body, and its caption", () => {
  const html = md.render("```screen A4 · Engine | Enter on **On this Mac** → A5\nWhere should golem think?\n```\n");
  assert.match(html, /<figure class="screen" v-pre><div class="screen-bar">/);
  assert.match(html, /<span class="screen-title">A4 · Engine<\/span>/);
  assert.match(html, /<pre class="screen-body">Where should golem think\?\n<\/pre>/);
  assert.match(html, /<figcaption class="screen-caption">Enter on <strong>On this Mac<\/strong> → A5<\/figcaption>/);
});

test("the stepper becomes pills, one per state", () => {
  const html = screen("✓ Service ── ● Engine ── ○ Model ── ! Ready");
  assert.match(html, /<span class="s-step s-done">✓ Service<\/span><span class="s-join">──<\/span>/);
  assert.match(html, /<span class="s-step s-now">● Engine<\/span>/);
  assert.match(html, /<span class="s-step s-todo">○ Model<\/span>/);
  assert.match(html, /<span class="s-step s-attn">! Ready<\/span>/);
});

test("the selected row is clay, and text after a wide gap is dim", () => {
  const html = screen("  › On this Mac      private, free\n    Later            /model any time");
  assert.match(html, /<span class="s-sel">  <span class="s-clay">›<\/span> On this Mac      <span class="s-dim">private, free<\/span><\/span>/);
  assert.match(html, /    Later            <span class="s-dim">\/model any time<\/span>/);
});

test("marks are coloured, and ! only at the start of a line", () => {
  const html = screen("✓ installed\n✗ failed\n! Ollama stopped\n⠙ starting…\n███░░ 2 GB\nwait! not this\n❯ ••••▏");
  assert.match(html, /<span class="s-ok">✓<\/span> installed/);
  assert.match(html, /<span class="s-fail">✗<\/span> failed/);
  assert.match(html, /<span class="s-attn">!<\/span> Ollama stopped/);
  assert.match(html, /<span class="s-spin">⠙<\/span> starting…/);
  assert.match(html, /<span class="s-bar"><span class="s-fill">███<\/span>░░<\/span> 2 GB/);
  assert.match(html, /\nwait! not this\n/);
  assert.match(html, /<span class="s-clay">❯<\/span> <span class="s-dim">••••<\/span><span class="s-cursor">▏<\/span>/);
});

test("the last line of hints shows its keys, and a rule is a line", () => {
  const html = screen("─────────\nEnter picks · ↑↓ move · Esc back");
  assert.match(html, /^.*<span class="s-rule"><\/span>/s);
  assert.match(
    html,
    /<span class="s-hint"><kbd>Enter<\/kbd><span class="s-dim"> picks<\/span><span class="s-dim"> · <\/span><kbd>↑↓<\/kbd>/,
  );
  assert.doesNotMatch(screen("connected   untitled   no model"), /s-hint/);
});

test("the text is escaped", () => {
  assert.match(screen("<b>{{ x }}</b> & more"), /&lt;b&gt;\{\{ x \}\}&lt;\/b&gt; &amp; more/);
});
