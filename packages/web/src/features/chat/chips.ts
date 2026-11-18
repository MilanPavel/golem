import { hostHue, hostLetter, hostOf, normalizeUrl, sourceFor, type TurnSource } from "@golem/view";

/** The class of a chip. The styles are in prose.css. */
export const CHIP = "src-chip";
const LABEL_MAX = 24;
/** Between two chips of one claim there may be only space and these marks. */
const BETWEEN = /^[\s,;.·•\-–—]*$/;

/** A mark for a host: its first letter on a colour from the host. No image is fetched. */
export function markElement(doc: Document, host: string, size?: "md" | "lg"): HTMLElement {
  const mark = doc.createElement("span");
  mark.className = size === undefined ? "src-mark" : `src-mark src-mark-${size}`;
  mark.setAttribute("aria-hidden", "true");
  mark.style.setProperty("--mark-hue", String(hostHue(host)));
  mark.textContent = hostLetter(host);
  return mark;
}

/** The name on a chip: the link text when it is short and not itself an address, else the host. */
export function chipLabel(linkText: string, host: string): string {
  const text = linkText.replace(/\s+/g, " ").trim();
  if (text === "" || text.length > LABEL_MAX || /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^www\./i.test(text)) return host;
  return text;
}

/** The hrefs a chip stands for, as chips store them. */
export function chipHrefs(chip: Element): string[] {
  try {
    const found: unknown = JSON.parse(chip.getAttribute("data-hrefs") ?? "[]");
    return Array.isArray(found) ? found.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

function isWebLink(a: HTMLAnchorElement): boolean {
  return normalizeUrl(a.getAttribute("href") ?? "") !== null;
}

function accessibleName(host: string, label: string, hrefs: string[], sources: readonly TurnSource[]): string {
  const first = hrefs[0] === undefined ? undefined : sourceFor(sources, hrefs[0]);
  const more = hrefs.length > 1 ? ` and ${hrefs.length - 1} more` : "";
  if (first === undefined) return `Not read, ${host}. golem did not search for or read this page${more}`;
  const title = first.title === "" ? label : first.title;
  return `Source: ${host}, ${title}${more}`;
}

/** One chip for one link. The text of the link goes: the chip names the site instead. */
function chipFor(a: HTMLAnchorElement, sources: readonly TurnSource[]): HTMLAnchorElement {
  const doc = a.ownerDocument;
  const href = a.getAttribute("href") ?? "";
  const host = hostOf(href);
  const known = sourceFor(sources, href) !== undefined;
  const chip = doc.createElement("a");
  chip.className = known ? CHIP : `${CHIP} src-chip-unread`;
  chip.setAttribute("href", href);
  chip.setAttribute("target", "_blank");
  chip.setAttribute("rel", "noopener noreferrer");
  chip.setAttribute("data-hrefs", JSON.stringify([href]));
  const label = doc.createElement("span");
  label.className = "src-label";
  label.textContent = chipLabel(a.textContent ?? "", host);
  chip.append(markElement(doc, host), label);
  chip.setAttribute("aria-label", accessibleName(host, label.textContent, [href], sources));
  return chip;
}

/** Whether only whitespace and punctuation lie between two nodes that share a parent. */
function adjacent(left: Element, right: Element): Text[] | null {
  const between: Text[] = [];
  for (let node = left.nextSibling; node !== right; node = node.nextSibling) {
    if (node === null || node.nodeType !== 3 || !BETWEEN.test(node.textContent ?? "")) return null;
    between.push(node as Text);
  }
  return between;
}

/** Folds `right` into `left`: its href joins the chip and it shows `+N`. */
function absorb(left: HTMLAnchorElement, right: HTMLAnchorElement, sources: readonly TurnSource[]): void {
  const hrefs = chipHrefs(left);
  const next = chipHrefs(right)[0];
  if (next === undefined) return;
  const key = normalizeUrl(next);
  if (!hrefs.some((h) => normalizeUrl(h) === key)) hrefs.push(next);
  left.setAttribute("data-hrefs", JSON.stringify(hrefs));
  let more = left.querySelector(".src-more");
  if (more === null) {
    more = left.ownerDocument.createElement("span");
    more.className = "src-more";
    left.append(more);
  }
  more.textContent = `+${hrefs.length - 1}`;
  const label = left.querySelector(".src-label")?.textContent ?? "";
  left.setAttribute("aria-label", accessibleName(hostOf(hrefs[0] ?? ""), label, hrefs, sources));
}

/**
 * Turns the web links of sanitized, rendered Markdown into source chips, in place.
 *
 * A link the turn found or read becomes a chip. Two or more chips side by side, with only space and
 * punctuation between them, become one chip that says `+N`. Any other web link becomes a dashed "not read"
 * chip. A link that is not http or https is left as the sanitizer made it. Everything is built with
 * `createElement` and `textContent`, so no text from a page or a model is read as markup. Running it
 * again does nothing to a chip that is already there.
 */
export function chipLinks(root: HTMLElement, sources: readonly TurnSource[]): void {
  const links = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => !a.classList.contains(CHIP) && isWebLink(a));
  const chips: HTMLAnchorElement[] = [];
  for (const a of links) {
    const chip = chipFor(a, sources);
    a.replaceWith(chip);
    chips.push(chip);
  }
  for (let i = 0; i < chips.length - 1; i += 1) {
    const left = chips[i];
    const right = chips[i + 1];
    if (left === undefined || right === undefined) continue;
    if (left.classList.contains("src-chip-unread") || right.classList.contains("src-chip-unread")) continue;
    const between = adjacent(left, right);
    if (between === null) continue;
    for (const node of between) node.remove();
    absorb(left, right, sources);
    right.remove();
    chips[i + 1] = left;
  }
}

/** A faded chip at the end of the text, for a link that is still being written. */
export function addPendingChip(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const chip = doc.createElement("span");
  chip.className = `${CHIP} src-chip-pending`;
  chip.setAttribute("aria-hidden", "true");
  chip.setAttribute("data-pending", "true");
  const mark = doc.createElement("span");
  mark.className = "src-mark src-mark-blank";
  chip.append(mark, doc.createTextNode("…"));
  const last = [...root.children].at(-1);
  const host = last !== undefined && (last.tagName === "P" || last.tagName === "LI") ? last : last?.querySelector("li:last-child, p:last-child") ?? root;
  host.append(doc.createTextNode(" "), chip);
}

/**
 * The text without a link that is still being written: `[arXiv](https://arx` has no closing bracket or
 * parenthesis yet, and Markdown would show it as it stands. Returns the same text when nothing is open.
 * An open `[` or `[label]` is cut only when `eager` says the answer is about web sources.
 */
export function withoutOpenLink(text: string, eager: boolean): { text: string; cut: boolean } {
  const open = /\[[^\]\n]*\]\([^)\n]*$/.exec(text) ?? (eager ? /\[[^\]\n]{0,80}\]?$/.exec(text) : null);
  if (open === null) return { text, cut: false };
  return { text: text.slice(0, open.index).replace(/[ \t]+$/, ""), cut: true };
}
