"""Draws the two-panel pictures: parchment on the left, a screen on the right, torn between.

- intro-wake.svg (the Introduction): "Golem, wake up!" On parchment, the golem of the other
  pictures sleeps under the moon, head bowed and eyes shut, and a shem (the scroll of the Prague
  legend) slides into the slot in its forehead. On the dark side the shem glows, the same golem's
  eyes light up, and `$ golem tui` then `> hello` types out beside it.
- arch-parts.svg (the architecture Overview): "Lay out the parts." On parchment the golem's
  parts float apart and come together. On a blueprint the same parts are numbered, and each
  lights up in turn next to the chapter it stands for: the head is the agent loop, the scroll is
  the model, and so on.

Both loop. Under prefers-reduced-motion each shows one still frame: awake, and laid out.

Run from the repo root: python3 scripts/figures/diptych.py docs/images
"""

import sys

from svg import GOLEM

W, H = 1000, 380
SPLIT = 500
DUR = "8s"

# Parchment.
PAPER_A, PAPER_B, PAPER_LINE = "#F1E6D2", "#E6D6BA", "#DCCAAB"
INK, MUTED, FAINT = "#3B2A1A", "#7A5A3A", "#A8916F"
BODY, BODY_LINE = "#9C6B3C", "#7E5530"
SCROLL, SCROLL_LINE = "#FBF3E2", "#8A6A48"
# The screens.
NIGHT, NIGHT_GRID = "#0B1311", "#15241F"
MINT, MINT_DIM = "#BDF5D6", "#3E9E73"
PRINT, PRINT_GRID, CYAN = "#0E1A2B", "#1B2C44", "#7CC8F2"

MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif"

# The parts, as (number, name, chapter, cells).
PARTS = [
    (1, "head", "the agent loop", [(3, 0), (4, 0), (5, 0), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1)]),
    (2, "torso", "the daemon", [(c, r) for r in (2, 3, 4) for c in range(2, 7)]),
    (3, "hips", "the protocol", [(c, 5) for c in range(2, 7)]),
    (4, "arm L", "tools", [(0, 2), (1, 2), (0, 3), (0, 4)]),
    (5, "arm R", "MCP", [(7, 2), (8, 2), (8, 3), (8, 4)]),
    (6, "foot L", "sessions", [(2, 6), (3, 6), (2, 7), (3, 7)]),
    (7, "foot R", "sandboxes", [(5, 6), (6, 6), (5, 7), (6, 7)]),
]
# How far each part floats from its place when laid out, in cells.
SPREAD = {1: (0, -1.4), 2: (0, 0), 3: (0, 0.9), 4: (-1.5, 0), 5: (1.5, 0), 6: (-0.8, 1.9), 7: (0.8, 1.9)}

STILL_STYLE = (
    "<style>.still { display:none } .anim { display:inline }"
    " @media (prefers-reduced-motion: reduce) { .still { display:inline } .anim { display:none } }</style>"
)


def text(x: float, y: float, s: str, size: float, fill: str, *, anchor: str = "middle", font: str = MONO, extra: str = "") -> str:
    return f'<text x="{x:g}" y="{y:g}" font-family="{font}" font-size="{size:g}" text-anchor="{anchor}" fill="{fill}"{extra}>{s}</text>'


def cells(x0: float, y0: float, cell: float, coords: list[tuple[int, int]], fill: str, line: str, outline: str) -> str:
    """Cells with a thick outline around the shape and a fine grid inside it."""
    pad = cell * 0.12
    out = [
        f'<rect x="{x0 + c * cell - pad:g}" y="{y0 + r * cell - pad:g}" width="{cell + 2 * pad:g}" height="{cell + 2 * pad:g}" fill="{outline}"/>'
        for c, r in coords
    ]
    out += [
        f'<rect x="{x0 + c * cell:g}" y="{y0 + r * cell:g}" width="{cell:g}" height="{cell:g}" fill="{fill}" stroke="{line}" stroke-width="0.6"/>'
        for c, r in coords
    ]
    return f'<g shape-rendering="crispEdges">{"".join(out)}</g>'


def scroll(x: float, y: float, w: float, fill: str, line: str, width: float = 3, glow: str = "", tilt: float = -6) -> str:
    """A rolled shem, centred on (x, y), tilted a little."""
    h = w * 0.26
    r = h * 0.62
    return (
        f'<g transform="rotate({tilt:g} {x:g} {y:g})"{glow}>'
        f'<rect x="{x - w / 2:g}" y="{y - h / 2:g}" width="{w:g}" height="{h:g}" rx="{h / 3:g}" fill="{fill}" stroke="{line}" stroke-width="{width}"/>'
        f'<circle cx="{x - w / 2:g}" cy="{y:g}" r="{r:g}" fill="{fill}" stroke="{line}" stroke-width="{width}"/>'
        f'<circle cx="{x + w / 2:g}" cy="{y:g}" r="{r:g}" fill="{fill}" stroke="{line}" stroke-width="{width}"/>'
        f'<path d="M{x - w * 0.28:g} {y - h * 0.12:g} H{x + w * 0.26:g} M{x - w * 0.28:g} {y + h * 0.16:g} H{x + w * 0.12:g}" stroke="{line}" stroke-width="{width * 0.7:g}" stroke-linecap="round"/>'
        "</g>"
    )


def parchment_half(defs_id: str) -> str:
    return (
        f'<linearGradient id="{defs_id}-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{PAPER_A}"/><stop offset="1" stop-color="{PAPER_B}"/></linearGradient>'
        f'<pattern id="{defs_id}-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">'
        f'<path d="M0 0 V9" stroke="{PAPER_LINE}" stroke-width="0.8" opacity="0.55"/></pattern>'
    )


def torn_edge() -> str:
    """The zigzag where the parchment tears, as the left edge of the screen half."""
    pts = []
    y = 0
    i = 0
    while y <= H:
        pts.append(f"{SPLIT + (10 if i % 2 else -2)},{y}")
        y += 26 + (i * 7) % 11
        i += 1
    pts.append(f"{SPLIT},{H}")
    return " ".join(pts)


def frame(defs: str, left: str, right: str, right_bg: str, aria: str) -> str:
    edge = torn_edge()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="{aria}"><title>{aria}</title>'
        f"{STILL_STYLE}<defs>{defs}"
        f'<clipPath id="card"><rect width="{W}" height="{H}" rx="22"/></clipPath>'
        f'<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        f'<filter id="soft"><feGaussianBlur stdDeviation="10"/></filter>'
        "</defs>"
        '<g clip-path="url(#card)">'
        f"{left}"
        f'<polygon points="{edge} {W},{H} {W},0" fill="{right_bg}"/>'
        f'<polyline points="{edge}" fill="none" stroke="#00000033" stroke-width="5" transform="translate(-3 0)"/>'
        f'<polyline points="{edge}" fill="none" stroke="#FFFFFF22" stroke-width="1.2"/>'
        f'<g clip-path="url(#screen)">{right}</g>'
        "</g>"
        f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="21" fill="none" stroke="#00000022" stroke-width="2"/>'
        "</svg>\n"
    ).replace("</defs>", f'<clipPath id="screen"><polygon points="{edge} {W},{H} {W},0"/></clipPath></defs>', 1)


def stars(points: list[tuple[float, float, float]], colour: str) -> str:
    """Plus-shaped stars that twinkle, each with its own delay."""
    out = []
    for x, y, delay in points:
        out.append(
            f'<path d="M{x - 7:g} {y:g} H{x + 7:g} M{x:g} {y - 7:g} V{y + 7:g}" stroke="{colour}" stroke-width="1.6">'
            f'<animate attributeName="opacity" dur="3.2s" begin="{delay}s" repeatCount="indefinite" values="0.9;0.25;0.9"/></path>'
        )
    return "".join(out)


def moon(x: float, y: float, colour: str) -> str:
    return (
        f'<path d="M{x + 20:g} {y - 46:g} A46 46 0 1 0 {x + 52:g} {y + 30:g} A38 38 0 1 1 {x + 20:g} {y - 46:g} Z" '
        f'fill="none" stroke="{colour}" stroke-width="2"/>'
    )


# --- Golem, wake up! ---------------------------------------------------------------------
# The golem of the other pictures (svg.GOLEM, 9 cells by 6), with a slot in its forehead where
# the shem goes, as on the Prague statue.


def golem_cells(rows: range) -> list[tuple[int, int]]:
    return [(c, r) for r in rows for c, ch in enumerate(GOLEM[r]) if ch != "."]


def slot(x0: float, y0: float, cell: float, fill: str, rim: str) -> str:
    """The hole in the forehead: across the three top cells."""
    return (
        f'<rect x="{x0 + 3.25 * cell:g}" y="{y0 + cell * 0.25:g}" width="{2.5 * cell:g}" height="{cell * 0.52:g}" '
        f'rx="3" fill="{fill}" stroke="{rim}" stroke-width="2"/>'
    )


def wake() -> str:
    cell = 30
    gx_l, gx_r, gy = 250 - 4.5 * cell, 750 - 4.5 * cell, 104
    neck_y = gy + 2 * cell
    slot_x, slot_y = 4.5 * cell, gy + cell * 0.51
    shem_w = 50
    ground = gy + 6 * cell + 4
    defs = parchment_half("p")

    # The parchment side: asleep, head bowed, eyes shut. The shem slides into the forehead.
    shem_still = scroll(gx_l + slot_x, slot_y, shem_w, SCROLL, INK, 2.5, tilt=0)
    shem_moving = (
        f'<g>{scroll(gx_l + slot_x, slot_y, shem_w, SCROLL, INK, 2.5, tilt=0)}'
        f'<animateTransform attributeName="transform" type="translate" dur="{DUR}" repeatCount="indefinite" '
        'keyTimes="0;0.06;0.12;0.27;0.94;1" values="190 -6;190 4;190 -2;0 0;0 0;190 -6"/>'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.03;0.93;0.97;1" values="0;1;1;0;0"/></g>'
        f'<path d="M{gx_l + slot_x + 150:g} {slot_y:g} H{gx_l + slot_x + 60:g}" stroke="{MUTED}" stroke-width="2" stroke-dasharray="4 5">'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.04;0.12;0.2;1" values="0;1;1;0;0"/></path>'
    )
    head_l = (
        f'<g transform="rotate(-7 {250:g} {neck_y:g}) translate(0 6)">'
        + cells(gx_l, gy, cell, golem_cells(range(2)), BODY, BODY_LINE, INK)
        + slot(gx_l, gy, cell, "#2A1408", INK)
        + f'<path d="M{gx_l + 3 * cell + 5:g} {gy + 1.55 * cell:g} h{cell - 10:g} M{gx_l + 5 * cell + 5:g} {gy + 1.55 * cell:g} h{cell - 10:g}" stroke="{INK}" stroke-width="3.5" stroke-linecap="round"/>'
        + f'<g class="still">{shem_still}</g><g class="anim">{shem_moving}</g>'
        + "</g>"
    )
    sleeping = cells(gx_l, gy, cell, golem_cells(range(2, 6)), BODY, BODY_LINE, INK) + head_l
    zz = "".join(
        f'<g opacity="0">{text(178 - k * 16, 88 - k * 16, "z", 15 + k * 4, MUTED, font=SERIF, extra=" font-style=\"italic\"")}'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;{0.02 + k * 0.05:.2f};{0.14 + k * 0.05:.2f};{0.22:.2f};1" values="0;0.8;0.8;0;0"/></g>'
        for k in range(3)
    )
    left = (
        f'<rect width="{SPLIT + 12}" height="{H}" fill="url(#p-paper)"/>'
        f'<rect width="{SPLIT + 12}" height="{H}" fill="url(#p-hatch)"/>'
        + moon(60, 92, FAINT)
        + stars([(150, 236, 0), (420, 60, 1.1), (440, 236, 2.2), (70, 290, 0.6), (330, 50, 1.7)], FAINT)
        + f'<ellipse cx="250" cy="{ground + 4:g}" rx="150" ry="10" fill="{INK}" opacity="0.12"/>'
        + f'<path d="M40 {ground:g} H470" stroke="{MUTED}" stroke-width="1.5" opacity="0.6"/>'
        + sleeping
        + f'<g class="anim">{zz}</g>'
        + text(250, 350, "Golem, wake up!", 44, "#5A3A1E", font=SERIF, extra=' font-style="italic"')
    )

    # The screen side: the shem glows in the forehead, the eyes light, and the prompt.
    eyes = "".join(
        f'<rect x="{gx_r + c * cell + 4:g}" y="{gy + cell + 4:g}" width="{cell - 8:g}" height="{cell - 8:g}" fill="{MINT}" filter="url(#glow)"/>'
        for c in (3, 5)
    )
    shem_lit = scroll(750, slot_y, shem_w, "#0B1311", MINT, 2.5, ' filter="url(#glow)"', tilt=0)
    halo = f'<ellipse cx="750" cy="{gy + cell:g}" rx="80" ry="46" fill="{MINT_DIM}" opacity="0.35" filter="url(#soft)"/>'
    dark_eyes = "".join(
        f'<rect x="{gx_r + c * cell:g}" y="{gy + cell:g}" width="{cell:g}" height="{cell:g}" fill="#2A1408"/>' for c in (3, 5)
    )
    awake_body = (
        cells(gx_r, gy, cell, golem_cells(range(6)), BODY, BODY_LINE, "#1A100A") + slot(gx_r, gy, cell, "#120A04", "#1A100A") + dark_eyes
    )
    lit = f"{halo}{eyes}{shem_lit}"

    def lit_anim() -> str:
        return (
            f'<g opacity="0">{lit}'
            f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.30;0.31;0.33;0.35;0.94;1" values="0;0;1;0.4;1;1;0"/></g>'
        )

    grid = "".join(f'<path d="M{x} 0 V{H}" stroke="{NIGHT_GRID}" stroke-width="1"/>' for x in range(510, W, 34)) + "".join(
        f'<path d="M{SPLIT} {y} H{W}" stroke="{NIGHT_GRID}" stroke-width="1"/>' for y in range(10, H, 34)
    )
    columns = [(560, 60, "101", 0.0), (600, 190, "01", 1.6), (548, 250, "10", 3.1), (910, 40, "1101", 0.8), (950, 160, "010", 2.4), (890, 250, "11", 4.0)]
    rain = []
    for x, y, bits, delay in columns:
        glyphs = "".join(text(x, y + i * 22, b, 17, MINT_DIM) for i, b in enumerate(bits))
        rain.append(
            f'<g opacity="0.75">{glyphs}<animateTransform attributeName="transform" type="translate" dur="7s" begin="{delay}s" '
            'repeatCount="indefinite" values="0 -10;0 22"/>'
            f'<animate attributeName="opacity" dur="7s" begin="{delay}s" repeatCount="indefinite" values="0;0.75;0.75;0" keyTimes="0;0.2;0.75;1"/></g>'
        )
    px = 672
    prompt_still = text(px, 330, "$ golem tui", 26, MINT, anchor="start") + text(px, 362, "&gt; hello", 22, MINT, anchor="start")
    typed = "".join(
        f'<tspan opacity="0">{ch}<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" '
        f'keyTimes="0;{0.40 + i * 0.03:.3f};{0.401 + i * 0.03:.3f};0.94;1" values="0;0;1;1;0"/></tspan>'
        for i, ch in enumerate("hello")
    )
    # 22px monospace is about 13.25px a character; the cursor sits after the last one shown.
    steps = [0.0] + [0.40 + i * 0.03 for i in range(5)]
    xs = [px + 13.25 * (2 + k) + 2 for k in range(6)]
    cursor = (
        f'<rect x="{xs[0]:g}" y="344" width="11" height="22" fill="{MINT}">'
        f'<animate attributeName="x" dur="{DUR}" repeatCount="indefinite" calcMode="discrete" '
        f'keyTimes="{";".join(f"{t:.3f}" for t in steps)};0.94" values="{";".join(f"{x:g}" for x in xs)};{xs[0]:g}"/>'
        '<animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;0.5;0.51;1"/></rect>'
    )
    prompt_anim = (
        f'<g opacity="0">{text(px, 330, "$ golem tui", 26, MINT, anchor="start")}'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.32;0.33;0.94;1" values="0;0;1;1;0"/></g>'
        f'<g opacity="0"><text x="{px}" y="362" font-family="{MONO}" font-size="22" fill="{MINT}" xml:space="preserve">&gt; {typed}</text>{cursor}'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.36;0.37;0.94;1" values="0;0;1;1;0"/></g>'
    )
    right = (
        f'<rect x="{SPLIT}" width="{W - SPLIT}" height="{H}" fill="{NIGHT}"/>{grid}'
        f'<g class="anim">{"".join(rain)}</g>'
        f'<ellipse cx="750" cy="{ground + 4:g}" rx="170" ry="12" fill="{MINT_DIM}" opacity="0.22"/>'
        f'<path d="M540 {ground:g} H{W - 30}" stroke="{MINT_DIM}" stroke-width="1.2" opacity="0.5"/>'
        + awake_body
        + f'<g class="still">{lit}{prompt_still}</g><g class="anim">{lit_anim()}{prompt_anim}</g>'
    )
    return frame(
        defs,
        left,
        right,
        NIGHT,
        "Golem, wake up! On parchment under a crescent moon, the golem sleeps with its head bowed and eyes shut, and the shem, a small scroll, slides into the slot in its forehead. On a dark screen the shem glows in the same golem's forehead, its eyes light up green, and a prompt types: dollar golem tui, then hello.",
    )


# --- Lay out the parts --------------------------------------------------------------------


def part_cells(n: int) -> list[tuple[int, int]]:
    return next(cells_ for num, _, _, cells_ in PARTS if num == n)


def parts() -> str:
    defs = parchment_half("q")

    # The parchment side: the parts float apart and come together, and the scroll goes in.
    cell = 22
    gx, gy = 250 - 4.5 * cell, 92
    floating = []
    still = []
    for n, *_ in PARTS:
        dx, dy = (v * cell for v in SPREAD[n])
        drawn = cells(gx, gy, cell, part_cells(n), BODY, BODY_LINE, INK)
        still.append(f'<g transform="translate({dx:g} {dy:g})">{drawn}</g>')
        floating.append(
            f"<g>{drawn}<animateTransform attributeName=\"transform\" type=\"translate\" dur=\"{DUR}\" repeatCount=\"indefinite\" "
            f'keyTimes="0;0.25;0.45;0.75;0.95;1" values="{dx:g} {dy:g};{dx:g} {dy:g};0 0;0 0;{dx:g} {dy:g};{dx:g} {dy:g}" '
            'calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1;0 0 1 1"/></g>'
        )
    guides = (
        f'<path d="M250 40 V{gy + 10 * cell:g} M{gx - 2 * cell:g} {gy + 2.5 * cell:g} H{gx + 11 * cell:g}" '
        f'stroke="{MUTED}" stroke-width="1" stroke-dasharray="4 5" opacity="0.6"/>'
    )
    shem_still = scroll(392, 54, 84, SCROLL, INK)
    shem_moving = (
        f"<g>{scroll(392, 54, 84, SCROLL, INK)}"
        f'<animateTransform attributeName="transform" type="translate" dur="{DUR}" repeatCount="indefinite" '
        f'keyTimes="0;0.45;0.55;0.75;0.85;1" values="0 0;0 0;-142 {gy + cell - 54:g};-142 {gy + cell - 54:g};0 0;0 0"/>'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.5;0.55;0.75;0.8;1" values="1;1;0;0;1;1"/></g>'
    )
    left = (
        f'<rect width="{SPLIT + 12}" height="{H}" fill="url(#q-paper)"/>'
        f'<rect width="{SPLIT + 12}" height="{H}" fill="url(#q-hatch)"/>'
        + moon(62, 82, FAINT)
        + stars([(400, 74, 0.4), (446, 196, 1.5), (60, 250, 2.3), (430, 286, 0.9)], FAINT)
        + guides
        + f'<ellipse cx="250" cy="300" rx="170" ry="9" fill="{INK}" opacity="0.12"/>'
        + f'<path d="M30 296 H470" stroke="{MUTED}" stroke-width="1.5" opacity="0.6"/>'
        + f'<g class="still">{"".join(still)}{shem_still}</g><g class="anim">{"".join(floating)}{shem_moving}</g>'
        + text(250, 350, "Lay out the parts.", 40, "#5A3A1E", font=SERIF, extra=' font-style="italic"')
    )

    # The blueprint side: the same parts, numbered, each lit in turn next to its chapter.
    cell_r = 17
    bx, by = 680 - 4.5 * cell_r, 92
    grid = "".join(f'<path d="M{x} 0 V{H}" stroke="{PRINT_GRID}" stroke-width="1"/>' for x in range(508, W, 28)) + "".join(
        f'<path d="M{SPLIT} {y} H{W}" stroke="{PRINT_GRID}" stroke-width="1"/>' for y in range(8, H, 28)
    )
    legend_items = [(n, name, chapter) for n, name, chapter, _ in PARTS] + [(8, "scroll", "the model")]
    count = len(legend_items)
    slot = 1 / count
    outlines = []
    lights = []
    badges = []
    for n, *_ in PARTS:
        dx, dy = (v * cell_r for v in SPREAD[n])
        coords = part_cells(n)
        xs = [c for c, _ in coords]
        ys = [r for _, r in coords]
        x0, x1 = bx + min(xs) * cell_r + dx, bx + (max(xs) + 1) * cell_r + dx
        y0, y1 = by + min(ys) * cell_r + dy, by + (max(ys) + 1) * cell_r + dy
        for c, r in coords:
            outlines.append(
                f'<rect x="{bx + c * cell_r + dx:g}" y="{by + r * cell_r + dy:g}" width="{cell_r}" height="{cell_r}" '
                f'fill="{CYAN}" fill-opacity="0.10" stroke="{CYAN}" stroke-opacity="0.35" stroke-width="0.7"/>'
            )
        a = (n - 1) * slot
        lights.append(
            f'<rect x="{x0 - 3:g}" y="{y0 - 3:g}" width="{x1 - x0 + 6:g}" height="{y1 - y0 + 6:g}" rx="3" fill="{CYAN}" fill-opacity="0.18" '
            f'stroke="{CYAN}" stroke-width="2" filter="url(#glow)" opacity="0">'
            f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;{a:.4f};{a + 0.005:.4f};{a + slot:.4f};{min(a + slot + 0.005, 1):.4f};1" values="0;0;1;1;0;0"/></rect>'
        )
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        badges.append(f'<circle cx="{cx:g}" cy="{cy:g}" r="9" fill="{CYAN}"/>' + text(cx, cy + 4, str(n), 11, PRINT, extra=' font-weight="bold"'))
    sx, sy = 566, 52
    a8 = 7 * slot
    shem_print = scroll(sx, sy, 62, PRINT, CYAN, 2, ' filter="url(#glow)"')
    lights.append(
        f'<rect x="{sx - 42}" y="{sy - 18:g}" width="84" height="36" rx="6" fill="{CYAN}" fill-opacity="0.15" stroke="{CYAN}" stroke-width="2" opacity="0">'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;{a8:.4f};{a8 + 0.005:.4f};0.995;1" values="0;0;1;1;0"/></rect>'
    )
    badges.append(f'<circle cx="{sx - 28}" cy="{sy - 20:g}" r="9" fill="{CYAN}"/>' + text(sx - 28, sy - 16, "8", 11, PRINT, extra=' font-weight="bold"'))
    legend = []
    for i, (n, name, chapter) in enumerate(legend_items):
        y = 58 + i * 33
        a = i * slot
        row = (
            text(800, y, str(n), 15, CYAN, anchor="start")
            + text(820, y, name, 15, "#9DB6CF", anchor="start")
            + text(820, y + 15, chapter, 13, "#6F8FAF", anchor="start")
        )
        legend.append(row)
        legend.append(
            f'<g opacity="0">{text(800, y, str(n), 15, "#FFFFFF", anchor="start")}{text(820, y, name, 15, "#FFFFFF", anchor="start")}'
            f'{text(820, y + 15, chapter, 13, CYAN, anchor="start")}'
            f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;{a:.4f};{a + 0.005:.4f};{a + slot:.4f};{min(a + slot + 0.005, 1):.4f};1" values="0;0;1;1;0;0"/></g>'
        )
    dim_y = 300
    dims = (
        f'<path d="M{bx:g} {dim_y} H{bx + 9 * cell_r:g} M{bx:g} {dim_y - 6} V{dim_y + 6} M{bx + 9 * cell_r:g} {dim_y - 6} V{dim_y + 6}" stroke="{CYAN}" stroke-width="1.2" opacity="0.7"/>'
        + text(bx + 4.5 * cell_r, dim_y + 18, "9 × 8 cells, assembled", 13, "#7E9AB6")
    )
    # The cursor is a character of the line, so it sits after "part" in any monospace font.
    cursor = '<tspan>█<animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;0.5;0.51;1"/></tspan>'

    right = (
        f'<rect x="{SPLIT}" width="{W - SPLIT}" height="{H}" fill="{PRINT}"/>{grid}'
        f'<path d="M680 40 V{by + 10 * cell_r:g} M{bx - 2 * cell_r:g} {by + 2.5 * cell_r:g} H{bx + 11 * cell_r:g}" stroke="{CYAN}" stroke-width="0.8" stroke-dasharray="4 5" opacity="0.35"/>'
        + "".join(outlines)
        + shem_print
        + f'<g class="anim">{"".join(lights)}</g>'
        + "".join(badges)
        + "".join(legend[0::2])
        + f'<g class="anim">{"".join(legend[1::2])}</g>'
        + dims
        + f'<text x="604" y="352" font-family="{MONO}" font-size="24" fill="{CYAN}" filter="url(#glow)" xml:space="preserve">&gt; change one part {cursor}</text>'
    )
    return frame(
        defs,
        left,
        right,
        PRINT,
        "Lay out the parts. On parchment, the golem's parts float apart and come back together, and the scroll slides into its head. On a blueprint the same parts are numbered, with a legend: 1 head, the agent loop; 2 torso, the daemon; 3 hips, the protocol; 4 left arm, tools; 5 right arm, MCP; 6 left foot, sessions; 7 right foot, sandboxes; 8 scroll, the model. Each lights up in turn. Below: change one part.",
    )


out = sys.argv[1]
for name, picture in [("intro-wake", wake()), ("arch-parts", parts())]:
    open(f"{out}/{name}.svg", "w").write(picture)
print("ok")
