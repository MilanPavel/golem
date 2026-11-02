import DOMPurify from "dompurify";
import { marked } from "marked";

const FORBIDDEN_TAGS = [
  "style",
  "script",
  "svg",
  "math",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "iframe",
  "frame",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "img",
  "video",
  "audio",
  "source",
];

// DOMPurify drops event handlers on its own; they are named here too so the rule is plain to read.
const FORBIDDEN_ATTRS = [
  "style",
  "srcset",
  "onerror",
  "onload",
  "onclick",
  "onmouseover",
  "onfocus",
  "onblur",
  "onanimationstart",
  "onpointerdown",
  "ontoggle",
];

/** http, https, mailto, and links without a scheme (a `#fragment` or a relative path). */
const ALLOWED_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// A dedicated instance, so the hook below never touches the global one.
const purifier = DOMPurify(window);

purifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Markdown to HTML that is safe to put in the page. The only way HTML enters it. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, async: false });
  return purifier.sanitize(html, {
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRS,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    ALLOW_DATA_ATTR: false,
  });
}
