// golem's own blocks for docs pages, styled in theme/custom.css after the web UI's
// (docs/design/web.md). docs/_kitchen-sink.md shows one of each.
//
//   ::: shem Allow `edit_file` on connect.ts? | rule: edit_file → ask · built-in default
//   ```diff … ```                    an approval: a clay seal, the question, the rule, the body
//   :::
//
//   ```tablet read_file packages/x.ts 600–640 · 41 lines
//   …output…                         a tool line and its output, in mono on code-bg, not parsed
//   ```
//
//   ::: concept [title]  /  ::: golem [title]    the two halves of a "How agents work" page

import container from "markdown-it-container";
import type { MarkdownRenderer as MarkdownIt } from "vitepress";

// The web UI's seal: a shield with a tick.
const SEAL =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 13.2 4v4.1c0 3-2.2 5.2-5.2 6.1-3-.9-5.2-3.1-5.2-6.1V4z"/><path d="m5.6 8 1.7 1.7L10.6 6.4"/></svg>';

// Shown, not pressed: the reader sees what golem would offer.
const ACTIONS =
  '<div class="shem-actions" aria-hidden="true">' +
  '<span class="shem-btn primary">Allow once <kbd>↵</kbd></span>' +
  '<span class="shem-btn">For this session <kbd>S</kbd></span>' +
  '<span class="shem-btn">Always <kbd>W</kbd></span>' +
  '<span class="shem-sp"></span>' +
  '<span class="shem-btn deny">Deny <kbd>D</kbd></span>' +
  "</div>";

/** What follows the container's name on its opening line, such as "concept In agents generally". */
function params(info: string, name: string): string {
  return info.trim().slice(name.length).trim();
}

export function golemContainers(md: MarkdownIt): void {
  md.use(container, "shem", {
    render(tokens: { info: string; nesting: number }[], idx: number) {
      const token = tokens[idx]!;
      if (token.nesting !== 1) return `</div>${ACTIONS}</section>\n`;
      const [question = "", rule = ""] = params(token.info, "shem").split(/\s+\|\s+/, 2);
      return (
        '<section class="shem" aria-label="Approval"><div class="shem-head">' +
        `<span class="seal">${SEAL}</span><div class="shem-ask">` +
        `<p class="shem-question">${md.renderInline(question || "May golem do this?")}</p>` +
        (rule ? `<p class="shem-rule">${md.renderInline(rule)}</p>` : "") +
        '</div></div><div class="shem-body">\n'
      );
    },
  });

  for (const [name, title] of [
    ["concept", "In agents generally"],
    ["golem", "In golem"],
  ] as const) {
    md.use(container, name, {
      render(tokens: { info: string; nesting: number }[], idx: number) {
        const token = tokens[idx]!;
        if (token.nesting !== 1) return "</div>\n";
        const text = md.renderInline(params(token.info, name) || title);
        return `<div class="golem-half ${name}"><p class="golem-half-title">${text}</p>\n`;
      },
    });
  }

  // A tablet is a fence, so the output inside is shown as it is and never read as markdown.
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const [lang, ...rest] = token.info.trim().split(/\s+/);
    if (lang !== "tablet") return fence(tokens, idx, options, env, self);
    const [tool = "", ...args] = rest;
    const [arg = "", result = ""] = args.join(" ").split(/\s+·\s+/, 2);
    const esc = md.utils.escapeHtml;
    const line = tool
      ? '<div class="tablet-line">' +
        `<span class="tablet-tool">${esc(tool)}</span>` +
        `<span class="tablet-arg">${esc(arg)}</span>` +
        (result ? `<span class="tablet-result">${esc(result)}</span>` : "") +
        "</div>"
      : "";
    // v-pre: Vue compiles each page, and output may hold a {{ … }} of its own.
    return `<figure class="tablet" v-pre>${line}<pre>${esc(token.content)}</pre></figure>\n`;
  };
}
