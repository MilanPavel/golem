"""What every figure in docs/images shares: golem's tokens, the card, and the animation helpers.

Colours are slip, and kiln under prefers-color-scheme: dark. With prefers-reduced-motion
anything in class ``anim`` is hidden, so the figure is still.
"""

DUR = "10s"
W = 880

STYLE = """<style>
  :root { --bg:#F3F2EF; --surface:#FBFAF8; --ink:#1D1A17; --muted:#57524C; --faint:#6C665F;
          --line:#B9B3AA; --clay:#C4783A; --clay-ink:#94501E; --soft:#F1E2D4; --sunken:#EAE8E3; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#15120F; --surface:#1D1915; --ink:#EEE7DF; --muted:#B5ACA2; --faint:#8F877E;
            --line:#5A5148; --clay:#D08549; --clay-ink:#E6A06A; --soft:#2E2118; --sunken:#110E0C; }
  }
  @media (prefers-reduced-motion: reduce) { .anim { display:none } }
  text { font-family: Geist, Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; fill: var(--ink); }
  .mono { font-family: "Geist Mono", "SF Mono", Menlo, Consolas, monospace; letter-spacing: .04em; }
  .label { font-size: 13px; fill: var(--muted); letter-spacing: .06em; }
  .small { font-size: 12px; }
  .faint { fill: var(--faint); }
  .muted { fill: var(--muted); }
  .clay { fill: var(--clay-ink); }
  .wire { stroke: var(--line); stroke-width: 1.2; fill: none; }
  .head { fill: var(--line); }
  .back { stroke-dasharray: 3 3; }
  .edge { fill: none; stroke: var(--line); stroke-width: 1.2; stroke-dasharray: 4 4; }
  .lit { fill: none; stroke: var(--clay); stroke-width: 1.8; }
  .box { fill: var(--surface); }
  .dot { fill: var(--clay); }
</style>"""


def card(h: int, aria: str, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}" role="img" aria-label="{aria}">\n'
        f"{STYLE}\n"
        f'<rect width="{W}" height="{h}" rx="12" fill="var(--bg)"/>\n{body}\n</svg>\n'
    )


def header(eyebrow: str, big: str, sub: str) -> str:
    return (
        f'<text class="mono label" x="32" y="44">{eyebrow}</text>'
        f'<text class="mono" x="848" y="62" text-anchor="end" font-size="40" style="fill:var(--clay-ink)">{big}</text>'
        f'<text x="848" y="90" text-anchor="end" font-size="16" class="muted">{sub}</text>'
    )


def window(start: float, end: float, fade: float = 0.012) -> tuple[str, str]:
    times = [0, max(start - fade, 0.0001), start, end, min(end + fade, 0.9999), 1]
    return ";".join(f"{t:.4f}" for t in times), "0;0;1;1;0;0"


def blink(start: float, end: float) -> str:
    times, values = window(start, end)
    return f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="{times}" values="{values}"/>'


def mover(path: str, start: float, end: float, size: int = 10) -> str:
    """A clay square that travels ``path`` between ``start`` and ``end``, hidden otherwise."""
    half = size / 2
    times = f"0;{start:.4f};{end:.4f};1"
    return (
        f'<rect class="dot" x="{-half}" y="{-half}" width="{size}" height="{size}" opacity="0">'
        f'<animateMotion dur="{DUR}" repeatCount="indefinite" calcMode="linear" path="{path}" '
        f'keyTimes="{times}" keyPoints="0;0;1;1"/>{blink(start, end)}</rect>'
    )


def outline(x: float, y: float, w: float, h: float, start: float, end: float) -> str:
    return f'<rect class="lit" x="{x}" y="{y}" width="{w}" height="{h}" rx="5" opacity="0">{blink(start, end)}</rect>'


def shown(text: str, start: float, end: float) -> str:
    """``text`` (a <text> element without its closing tag's animation) shown between start and end."""
    return text.replace("</text>", f"{blink(start, end)}</text>").replace("<text ", '<text opacity="0" ', 1)


def arrow_down(x: float, y1: float, y2: float, back: bool = False) -> str:
    cls = "wire back" if back else "wire"
    return f'<path class="{cls}" d="M{x} {y1} V{y2 - 1}"/><path class="head" d="M{x - 4} {y2 - 7} L{x} {y2} L{x + 4} {y2 - 7} Z"/>'


def arrow_up(x: float, y1: float, y2: float, back: bool = False) -> str:
    cls = "wire back" if back else "wire"
    return f'<path class="{cls}" d="M{x} {y1} V{y2 + 1}"/><path class="head" d="M{x - 4} {y2 + 7} L{x} {y2} L{x + 4} {y2 + 7} Z"/>'


def arrow_right(x1: float, x2: float, y: float) -> str:
    return f'<path class="wire" d="M{x1} {y} H{x2 - 1}"/><path class="head" d="M{x2 - 7} {y - 4} L{x2} {y} L{x2 - 7} {y + 4} Z"/>'
