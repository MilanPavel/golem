import { languageFor } from "./languages.ts";

const ITALIC = 1;
const BOLD = 2;

type Token = { content: string; color?: string | undefined; fontStyle?: number | undefined };

/** Rebuilds a code element's children as coloured spans. No HTML is parsed: the text stays text. */
function paint(code: HTMLElement, lines: readonly (readonly Token[])[]): void {
  const doc = code.ownerDocument;
  const nodes: Node[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(doc.createTextNode("\n"));
    for (const token of line) {
      const span = doc.createElement("span");
      span.textContent = token.content;
      if (token.color) span.style.color = token.color;
      if (token.fontStyle && token.fontStyle & ITALIC) span.style.fontStyle = "italic";
      if (token.fontStyle && token.fontStyle & BOLD) span.style.fontWeight = "600";
      nodes.push(span);
    }
  });
  code.replaceChildren(...nodes);
  code.dataset["highlighted"] = "true";
}

/**
 * Colours the fenced code blocks under `root` whose language golem knows. Shiki loads on the first
 * call that finds one. A block whose text changed while the tokens were coming is left alone.
 */
export async function highlightCodeBlocks(root: HTMLElement): Promise<void> {
  const targets: { code: HTMLElement; text: string; language: NonNullable<ReturnType<typeof languageFor>> }[] = [];
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class^="language-"]')) {
    if (code.dataset["highlighted"]) continue;
    const language = languageFor(code.className.slice("language-".length).split(/\s/)[0] ?? "");
    if (language) targets.push({ code, text: code.textContent ?? "", language });
  }
  if (targets.length === 0) return;

  const { tokenize } = await import("./highlight-engine.ts");
  for (const { code, text, language } of targets) {
    try {
      const lines = await tokenize(text.replace(/\n$/, ""), language);
      if (code.isConnected && code.textContent === text) paint(code, lines);
    } catch {
      // A grammar that fails leaves the block plain.
    }
  }
}
