import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { golemContainers } from "./containers.ts";

const md = new MarkdownIt();
golemContainers(md);

test("a shem has the seal, the question, the rule, its body, and the choices", () => {
  const html = md.render(
    "::: shem Allow `edit_file` on connect.ts? | rule: edit_file → ask · built-in default\nThe diff.\n:::\n",
  );
  assert.match(html, /<section class="shem" aria-label="Approval">/);
  assert.match(html, /<span class="seal"><svg/);
  assert.match(html, /<p class="shem-question">Allow <code>edit_file<\/code> on connect\.ts\?<\/p>/);
  assert.match(html, /<p class="shem-rule">rule: edit_file → ask · built-in default<\/p>/);
  assert.match(html, /<div class="shem-body">\n<p>The diff\.<\/p>\n<\/div><div class="shem-actions"/);
  assert.match(html, /Allow once <kbd>↵<\/kbd>.*Deny <kbd>D<\/kbd>/);
});

test("a shem without a rule has no rule line", () => {
  assert.doesNotMatch(md.render("::: shem Run `pytest -q`?\n:::\n"), /shem-rule/);
});

test("concept and golem have their default titles, or the one given", () => {
  assert.match(md.render("::: concept\nx\n:::\n"), /<div class="golem-half concept"><p class="golem-half-title">In agents generally<\/p>/);
  assert.match(md.render("::: golem\nx\n:::\n"), /<p class="golem-half-title">In golem<\/p>/);
  assert.match(md.render("::: golem How golem keeps it\nx\n:::\n"), /<p class="golem-half-title">How golem keeps it<\/p>/);
});

test("a tablet shows its tool line and the output as it is", () => {
  const html = md.render("```tablet read_file src/x.ts 600–640 · 41 lines\n<b>{{ raw }}</b> *not markdown*\n```\n");
  assert.match(html, /<figure class="tablet" v-pre>/);
  assert.match(
    html,
    /<span class="tablet-tool">read_file<\/span><span class="tablet-arg">src\/x\.ts 600–640<\/span><span class="tablet-result">41 lines<\/span>/,
  );
  assert.match(html, /<pre>&lt;b&gt;\{\{ raw \}\}&lt;\/b&gt; \*not markdown\*\n<\/pre>/);
});

test("a tablet with no tool is the output alone, and other fences are left alone", () => {
  assert.doesNotMatch(md.render("```tablet\nok\n```\n"), /tablet-line/);
  assert.match(md.render("```bash\nls\n```\n"), /<code class="language-bash">ls/);
});
