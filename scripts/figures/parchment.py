"""Draws the parchment pictures of the home page.

They share the look of why-local.svg and the other "Why golem" cards: parchment, pixel art,
monospace labels. They stay parchment in both themes (the theme dims them a little in dark).
Anything in class ``anim`` is hidden under prefers-reduced-motion, so the picture is still.

- why-route.svg: requests split between a local model for nothing and a hosted one, under a
  budget.
- why-away.svg: night; the golem and three helpers work, and the phone asks for one review.
- why-app.svg: your app calls the agent in its container; the model sits outside the wall.

Run from the repo root: python3 scripts/figures/parchment.py docs/images
"""

import sys

from svg import GOLEM

BG, EDGE = "#F4EBDD", "#D8C6A8"
FLOOR = "#E6D5BA"
INK, MUTED, FAINT = "#3B2A1A", "#7A5A3A", "#B9A27F"
BODY, EYE = "#9C6B3C", "#2A1408"
PAPER, PAPER_EDGE = "#FFFDF7", "#CDB894"
CLOUD_INK = "#6E7A86"
GREEN, GOLD, RED = "#6E9A5E", "#D9A93A", "#B5583A"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
DUR = "8s"

CLOUD_ROWS = ["...####......", ".#########.##", "#############", "##############", ".############"]
MOON_ROWS = ["..####.", ".###...", "###....", "###....", "###....", ".###...", "..####."]


def svg(w: int, h: int, aria: str, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{aria}">'
        f"<title>{aria}</title>"
        "<style>@media (prefers-reduced-motion: reduce) { .anim { display:none } }</style>"
        f'<rect x="1" y="1" width="{w - 2}" height="{h - 2}" rx="14" fill="{BG}" stroke="{EDGE}" stroke-width="2"/>'
        f"{body}</svg>\n"
    )


def t(x: float, y: float, s: str, size: int = 11, fill: str = MUTED, anchor: str = "start", bold: bool = False) -> str:
    weight = "bold" if bold else "normal"
    return (
        f'<text x="{x:g}" y="{y:g}" font-family="{MONO}" font-size="{size}" font-weight="{weight}" '
        f'text-anchor="{anchor}" fill="{fill}">{s}</text>'
    )


def pixels(x: float, y: float, rows: list[str], cell: float, fill: str, eye: str = EYE) -> str:
    out = []
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != ".":
                colour = eye if ch == "o" else fill
                out.append(f'<rect x="{x + c * cell:g}" y="{y + r * cell:g}" width="{cell:g}" height="{cell:g}" fill="{colour}"/>')
    return f'<g shape-rendering="crispEdges">{"".join(out)}</g>'


def golem(x: float, y: float, cell: float, fill: str = BODY, shadow: bool = True) -> str:
    """The pixel golem, 9 cells by 6, with its shadow."""
    s = ""
    if shadow:
        s = f'<ellipse cx="{x + 4.5 * cell:g}" cy="{y + 6 * cell + 2:g}" rx="{3.8 * cell:g}" ry="3" fill="{INK}" opacity="0.15"/>'
    return s + pixels(x, y, GOLEM, cell, fill)


def blink(a: float, b: float) -> str:
    """Visible from fraction a to fraction b of the loop."""
    times = f"0;{max(a - 0.01, 0.0001):.4f};{a:.4f};{b:.4f};{min(b + 0.01, 0.9999):.4f};1"
    return f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="{times}" values="0;0;1;1;0;0"/>'


def dot(path: str, a: float, b: float, size: float = 8, fill: str = BODY) -> str:
    """A square that travels ``path`` from fraction a to b, hidden otherwise."""
    h = size / 2
    return (
        f'<rect x="{-h}" y="{-h}" width="{size}" height="{size}" fill="{fill}" opacity="0">'
        f'<animateMotion dur="{DUR}" repeatCount="indefinite" path="{path}" keyTimes="0;{a:.4f};{b:.4f};1" keyPoints="0;0;1;1" calcMode="linear"/>'
        f"{blink(a, b)}</rect>"
    )


def anim(*parts: str) -> str:
    return f'<g class="anim">{"".join(parts)}</g>'


# --- Why: smart routing -------------------------------------------------------------------


def why_route() -> str:
    slips = [("rename x", 46), ("a receipt", 92), ("plan it", 138)]
    parts = [t(220, 30, "the cheapest model that can do it", 11, MUTED, "middle")]
    for s, y in slips:
        parts.append(f'<rect x="24" y="{y}" width="96" height="30" fill="{PAPER}" stroke="{PAPER_EDGE}" stroke-width="2"/>')
        parts.append(t(34, y + 19, s, 11, INK))
    parts += [
        golem(152, 94, 7),
        t(184, 156, "router", 11, MUTED, "middle"),
        f'<path d="M216 112 C250 112 250 70 290 70" fill="none" stroke="{FAINT}" stroke-width="2" stroke-dasharray="5 5"/>',
        f'<path d="M216 120 C250 120 250 168 290 168" fill="none" stroke="{FAINT}" stroke-width="2" stroke-dasharray="5 5"/>',
        f'<rect x="290" y="40" width="128" height="60" fill="{PAPER}" stroke="{PAPER_EDGE}" stroke-width="2"/>',
        pixels(300, 52, ["####", "#..#", "#..#", "####"], 5, BODY),
        t(332, 64, "local", 13, INK),
        t(332, 86, "$0.00", 13, INK, "start", True),
        f'<rect x="290" y="138" width="128" height="60" fill="{PAPER}" stroke="{PAPER_EDGE}" stroke-width="2"/>',
        pixels(299, 160, CLOUD_ROWS[1:4], 1.6, CLOUD_INK),
        t(332, 162, "hosted", 13, INK),
        t(332, 184, "$0.02", 13, INK, "start", True),
        t(24, 222, "budget", 11, MUTED),
        f'<rect x="80" y="214" width="338" height="10" fill="{PAPER}" stroke="{PAPER_EDGE}"/>',
        f'<rect x="81" y="215" width="12" height="8" fill="{BODY}"/>',
        t(418, 240, "$0.02 of $1.00 today", 10, MUTED, "end"),
    ]
    moves = anim(
        dot("M120 61 C140 61 140 112 152 112", 0.02, 0.10),
        dot("M216 112 C250 112 250 70 290 70", 0.12, 0.22),
        dot("M120 107 C136 107 140 114 152 114", 0.32, 0.40),
        dot("M216 112 C250 112 250 70 290 70", 0.42, 0.52),
        dot("M120 153 C140 153 140 118 152 118", 0.62, 0.70),
        dot("M216 120 C250 120 250 168 290 168", 0.72, 0.82, 8, RED),
    )
    return svg(
        440,
        250,
        "Three requests reach the router golem. Renaming a variable and reading a receipt go to a local model for $0.00; planning goes to a hosted model for $0.02. A budget bar shows $0.02 of $1.00 spent today",
        "".join(parts) + moves,
    )


# --- Why: works while you are away --------------------------------------------------------


def why_away() -> str:
    night = "#E6DCCB"
    parts = [
        f'<rect x="12" y="12" width="416" height="226" rx="8" fill="{night}"/>',
        pixels(36, 30, MOON_ROWS, 5, GOLD),
        *(f'<rect x="{x}" y="{y}" width="4" height="4" fill="{FAINT}"/>' for x, y in [(90, 40), (150, 28), (200, 52), (250, 34)]),
        t(80, 76, "02:14 · you are asleep", 11, MUTED),
        golem(40, 120, 8),
    ]
    helpers = []
    for i in range(3):
        x, y = 140 + i * 46, 150
        parts.append(golem(x, y, 3.5))
        parts.append(f'<rect x="{x}" y="{y + 30}" width="32" height="5" fill="{PAPER}" stroke="{PAPER_EDGE}"/>')
        a = 0.05 + i * 0.12
        helpers.append(
            f'<rect x="{x}" y="{y + 30}" width="0" height="5" fill="{BODY}">'
            f'<animate attributeName="width" dur="{DUR}" repeatCount="indefinite" keyTimes="0;{a:.2f};{a + 0.3:.2f};0.96;1" values="0;0;32;32;0"/></rect>'
        )
    parts += [
        t(130, 216, "a workflow · 3 sub-agents", 10, MUTED),
        f'<rect x="300" y="30" width="112" height="196" rx="16" fill="{INK}"/>',
        '<rect x="308" y="44" width="96" height="170" rx="8" fill="#4A3826"/>',
        t(356, 76, "07:30", 20, PAPER, "middle", True),
    ]
    note = (
        f'<g opacity="0"><rect x="312" y="96" width="88" height="70" rx="5" fill="{PAPER}"/>'
        + t(320, 114, "golem", 9, MUTED)
        + t(320, 132, "3 PRs green", 10, INK, "start", True)
        + t(320, 146, "post them?", 10, INK)
        + f'<rect x="320" y="152" width="72" height="10" rx="2" fill="{GREEN}"/>'
        + t(356, 160, "allow", 8, PAPER, "middle", True)
        + f"{blink(0.50, 0.96)}</g>"
    )
    still = (
        f'<g class="still"><rect x="312" y="96" width="88" height="70" rx="5" fill="{PAPER}"/>'
        + t(320, 114, "golem", 9, MUTED)
        + t(320, 132, "3 PRs green", 10, INK, "start", True)
        + t(320, 146, "post them?", 10, INK)
        + "</g>"
    )
    style = "<style>.still { display:none } @media (prefers-reduced-motion: reduce) { .still { display:inline } }</style>"
    return svg(
        440,
        250,
        "At night, while you are asleep, the golem and three small helper golems work through a workflow, each with a progress bar. In the morning the phone shows a notification: 3 PRs green, post them? with an allow button",
        "".join(parts) + style + still + anim(*helpers, note),
    )


# --- Why: the agent behind your app -------------------------------------------------------


def why_app() -> str:
    parts = [
        f'<rect x="22" y="46" width="128" height="124" fill="{PAPER}" stroke="{INK}" stroke-width="3"/>',
        f'<rect x="22" y="46" width="128" height="16" fill="{INK}"/>',
        *(f'<rect x="{x}" y="51" width="6" height="6" fill="{c}"/>' for x, c in [(30, RED), (40, GOLD), (50, GREEN)]),
        f'<rect x="32" y="74" width="80" height="14" fill="{FLOOR}"/>',
        f'<rect x="58" y="96" width="82" height="14" fill="{BODY}" opacity="0.5"/>',
        f'<rect x="32" y="118" width="64" height="14" fill="{FLOOR}"/>',
        f'<rect x="32" y="146" width="108" height="14" fill="{PAPER}" stroke="{PAPER_EDGE}"/>',
        t(86, 192, "your app", 12, INK, "middle", True),
        f'<path d="M150 108 H180" stroke="{FAINT}" stroke-width="2" stroke-dasharray="5 4"/>',
        t(165, 98, "API", 10, MUTED, "middle"),
        f'<rect x="182" y="40" width="124" height="150" fill="none" stroke="{MUTED}" stroke-width="2" stroke-dasharray="7 5"/>',
        golem(208, 72, 8),
        f'<rect x="196" y="136" width="96" height="22" fill="{PAPER}" stroke="{PAPER_EDGE}" stroke-width="2"/>',
        t(244, 151, "support.md", 10, INK, "middle"),
        t(244, 208, "the agent", 12, INK, "middle", True),
        t(244, 224, "no model inside", 10, MUTED, "middle"),
        f'<path d="M324 30 V230" stroke="{BODY}" stroke-width="4" stroke-dasharray="10 6"/>',
        f'<path d="M306 108 H342" stroke="{FAINT}" stroke-width="2" stroke-dasharray="5 4"/>',
        f'<rect x="344" y="72" width="76" height="72" fill="{INK}"/>',
        *(f'<rect x="352" y="{y}" width="60" height="5" fill="#5A4632"/>' for y in (82, 94, 106, 118, 130)),
        f'<rect x="404" y="80" width="6" height="6" fill="{GREEN}"/>',
        t(382, 166, "a model", 12, INK, "middle", True),
        t(382, 182, "any URL", 10, MUTED, "middle"),
    ]
    moves = anim(
        dot("M150 108 H200", 0.04, 0.14),
        dot("M290 108 H344", 0.18, 0.28),
        *(dot("M344 112 H290", 0.32 + k * 0.06, 0.42 + k * 0.06, 6) for k in range(3)),
        dot("M200 112 H150", 0.56, 0.66),
    )
    return svg(
        440,
        250,
        "Your app calls the agent over an API. The agent, the golem with its support.md file, runs in a container with no model inside. Beyond a dashed wall sits the model, a server at any URL. A request travels app to agent to model, and tokens come back",
        "".join(parts) + moves,
    )


out = sys.argv[1]
for name, picture in [
    ("why-route", why_route()),
    ("why-away", why_away()),
    ("why-app", why_app()),
]:
    open(f"{out}/{name}.svg", "w").write(picture)
print("ok")
