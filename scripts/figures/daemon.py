"""Draws the figures of docs/architecture/daemon.md as animated SVGs.

- daemon-apart.svg: why an agent runs apart from its windows. Inside a terminal, closing it ends
  the work. Apart, in a background process, any number of windows attach, and one closing
  changes nothing.
- daemon-start.svg: how golem's daemon starts, in order: the pid lock, the databases, the runs a
  crash left open, the stale socket, the bind with mode 0600, and the 5 s watch. launchd starts
  it again after it exits.

Run from the repo root: python3 scripts/figures/daemon.py docs/images
"""

import sys

from svg import arrow_down, arrow_left, arrow_right, blink, card, facts, header, mover, outline, shown

END = 0.985


def box(x: int, y: int, w: int, h: int, title: str, sub: str = "", mono: bool = False) -> str:
    cls = ' class="mono"' if mono else ""
    out = f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>'
    out += f'<text{cls} x="{x + 14}" y="{y + 24}" font-size="14">{title}</text>'
    if sub:
        out += f'<text class="small faint" x="{x + 14}" y="{y + 42}">{sub}</text>'
    return out


def cover(x: int, y: int, w: int, h: int, start: float, end: float, word: str) -> str:
    """A sunken veil over a box, with a word, between start and end."""
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="var(--sunken)" opacity="0">{blink(start, end)}</rect>'
        + shown(f'<text class="mono small clay" x="{x + 14}" y="{y + 28}">{word}</text>', start, end)
    )


# --- Apart from the windows, in agents generally -----------------------------------------

CLIENTS = [(160, "a terminal"), (232, "a browser tab"), (304, "a timer, later")]


def apart() -> str:
    parts = [
        '<text class="mono label" x="30" y="140">INSIDE THE WINDOW</text>',
        '<text class="mono label" x="470" y="140">APART FROM THE WINDOWS</text>',
        '<path class="edge" d="M440 146 V404"/>',
        # Left: the agent lives inside one terminal.
        '<rect class="box" x="30" y="160" width="380" height="176" rx="2"/>',
        '<text x="44" y="184" font-size="14">a terminal</text>',
        '<rect x="54" y="204" width="332" height="108" rx="2" fill="var(--soft)"/>',
        '<text x="70" y="230" font-size="14">the agent</text>',
        '<text class="small faint" x="70" y="250">the chat, the model calls, the tools</text>',
        '<text class="small faint" x="70" y="268">all in this one process</text>',
        '<text class="small muted" x="30" y="392">Close it, and the work stops with it.</text>',
        # Right: windows attach to one background process.
        '<rect class="box" x="700" y="200" width="150" height="120" rx="2" style="fill:var(--soft)"/>',
        '<text x="714" y="226" font-size="14">the agent</text>',
        '<text class="small faint" x="714" y="244">a background</text>',
        '<text class="small faint" x="714" y="260">process</text>',
        '<text class="small muted" x="470" y="392">Close one, and the others and the work go on.</text>',
    ]
    for y, name in CLIENTS:
        parts.append(box(470, y, 150, 52, name))
        parts.append(f'<path class="wire" d="M620 {y + 26} H660 V260 H697"/>')
    parts.append('<path class="head" d="M690 256 L697 260 L690 264 Z"/>')
    anim = [
        # Left: the terminal closes and takes the agent with it.
        mover("M70 290 H370", 0.03, 0.20),
        cover(30, 160, 380, 176, 0.24, 0.62, "closed: the chat is gone"),
        # Right: events go to every window.
        mover("M697 260 H660 V186 H621", 0.06, 0.14),
        mover("M697 260 H660 V258 H621", 0.06, 0.14),
        mover("M697 260 H660 V330 H621", 0.06, 0.14),
        cover(470, 160, 150, 52, 0.24, 0.62, "closed"),
        mover("M697 260 H660 V258 H621", 0.30, 0.38),
        mover("M697 260 H660 V330 H621", 0.30, 0.38),
        outline(696, 196, 158, 128, 0.38, 0.50),
        shown('<text class="mono small clay" x="700" y="344">still running</text>', 0.38, END),
        # A new terminal opens and catches up.
        outline(466, 156, 158, 60, 0.66, 0.80),
        shown('<text class="mono small clay" x="484" y="202">opened again: catches up</text>', 0.66, END),
        mover("M697 260 H660 V186 H621", 0.70, 0.80),
    ]
    body = f"""{header("IN AGENTS GENERALLY", "apart", "the work outlives every window")}
{"".join(parts)}
<text class="small muted" x="30" y="432">Apart means two programs, and a language between them: the next chapter.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        458,
        "Why an agent runs apart from its windows. Inside the window, the chat, the model calls, and the tools are all in one terminal's process: close it, and the work stops with it. Apart, a background process holds the work, and a terminal, a browser tab, and later a timer attach to it. One window closes and the others and the work go on. Opened again, it catches up.",
        body,
    )


# --- The start, in golem ------------------------------------------------------------------

ROW1 = [
    (30, "flock golem.pid", "in run/, for life"),
    (236, "open the databases", "copy, then migrate"),
    (442, "close open runs", "a crash left them"),
    (648, "unlink golem.sock", "a stale one, if any"),
]
ROW2 = [
    (648, "bind golem.sock", "mode 0600, listen"),
    (442, "every 5 s", "is it still our socket?"),
    (236, "the daemon exits", "a crash, a stop, gone"),
    (30, "launchd", "KeepAlive, after 2 s"),
]
BW = 180


def start() -> str:
    parts = []
    for x, title, sub in ROW1:
        parts.append(box(x, 150, BW, 56, title, sub, mono=title.startswith(("flock", "unlink"))))
    for x, title, sub in ROW2:
        parts.append(box(x, 290, BW, 56, title, sub, mono=title.startswith("bind")))
    for x in (210, 416, 622):
        parts.append(arrow_right(x, x + 26, 178))
    parts.append(arrow_down(738, 206, 288))
    for x in (648, 442, 236):
        parts.append(arrow_left(x, x - 26 + 0, 318))
    parts.append('<path class="wire" d="M120 290 V209"/><path class="head" d="M116 216 L120 209 L124 216 Z"/>')
    parts.append('<text class="small faint" x="130" y="256">starts it again</text>')
    # The busy branch.
    parts.append('<path class="wire back" d="M30 178 H14 V392 H28"/><path class="head" d="M21 388 L28 392 L21 396 Z"/>')
    parts.append('<rect class="box" x="30" y="372" width="820" height="40" rx="2"/>')
    parts.append('<text class="mono small" x="44" y="396">lock busy: exit 1, and run/last-error says who holds it and how to stop it</text>')
    parts.append(facts([
        "A second start, real: daemon already running (pid 10406), exit 1",
        "After kill -9, golem.sock stays behind until the next start removes it",
        "rm golem.sock at 19:56:48: the daemon logged is gone; stopping at 19:56:49",
    ], 30, 446))
    path = "M120 178 H738 V318 H120 V210"
    anim = [mover(path, 0.04, 0.72)]
    stops = [
        (26, 146, 0.04, 0.12), (232, 146, 0.12, 0.20), (438, 146, 0.20, 0.28), (644, 146, 0.28, 0.36),
        (644, 286, 0.36, 0.46), (438, 286, 0.46, 0.56), (232, 286, 0.56, 0.63), (26, 286, 0.63, 0.70),
    ]
    for x, y, a, b in stops:
        anim.append(outline(x, y, BW + 8, 64, a, b))
    anim.append(shown('<text class="mono small clay" x="250" y="282">kill -9</text>', 0.56, 0.66))
    anim.append(outline(26, 368, 828, 48, 0.76, 0.94))
    anim.append(mover("M30 178 H14 V392 H28", 0.72, 0.78))
    body = f"""{header("THE START, IN GOLEM", "0600", "one daemon per home, one socket")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        528,
        "How golem's daemon starts. It takes a flock on run/golem.pid for the life of the process. It opens golem.db and checkpoints.db, copying them before a migration, and closes the runs a crash left open. Only then does it unlink a stale golem.sock, bind a new one with mode 0600, and listen. Every 5 seconds it checks that the socket is still its own. When it exits, launchd starts it again after 2 seconds. When the lock is busy, it exits 1 and run/last-error says who holds it. Real: a second start said daemon already running, pid 10406. After kill -9 the socket stayed until the next start. A removed socket stopped the daemon a second later.",
        body,
    )


out = sys.argv[1]
for name, svg in [("daemon-apart", apart()), ("daemon-start", start())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
