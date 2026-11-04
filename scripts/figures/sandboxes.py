"""Draws the figures of docs/architecture/sandboxes.md as animated SVGs.

- sandbox-layers.svg: two guards. A permission decides whether a command runs, and a sandbox
  decides what a command that runs may touch. Three commands, stopped at the first wall, at the
  second, or at neither.
- sandbox-shell.svg: five real commands from one run under golem's sandbox: a write in the
  project works; a write to the home folder, a read of ~/.ssh, the network, and a key in the
  environment do not.

Run from the repo root: python3 scripts/figures/sandboxes.py docs/images
"""

import sys

from svg import blink, card, header, mover, shown


def cross(x: float, y: float, start: float, end: float) -> str:
    return (
        f'<text class="mono clay" x="{x}" y="{y + 7}" text-anchor="middle" font-size="22" opacity="0">×{blink(start, end)}</text>'
    )


def wall(x: float, y1: float, y2: float, title: str, sub: str) -> str:
    return (
        f'<rect x="{x - 3}" y="{y1}" width="6" height="{y2 - y1}" rx="3" style="fill:var(--clay)" opacity=".55"/>'
        f'<text class="mono label" x="{x}" y="{y1 - 28}" text-anchor="middle">{title}</text>'
        f'<text x="{x}" y="{y1 - 10}" text-anchor="middle" font-size="13" class="muted">{sub}</text>'
    )


def row_wire(x1: float, x2: float, y: float) -> str:
    return f'<path class="edge" d="M{x1} {y} H{x2}"/>'


# --- Two guards, in agents generally ------------------------------------------------------

LAYER_ROWS = [
    ("rm -rf ~", "you said no", "your home folder", 1),
    ("cat ~/.ssh/id_ed25519", "you said yes, by mistake", "your SSH keys", 2),
    ("pytest -q", "you said yes", "the project", 0),
]
LAYER_Y = [200, 270, 340]


def layers() -> str:
    parts = [wall(340, 168, 372, "PERMISSION", "may it run?"), wall(580, 168, 372, "SANDBOX", "what may it touch?")]
    anim = []
    for i, ((cmd, answer, target, stop), y) in enumerate(zip(LAYER_ROWS, LAYER_Y, strict=True)):
        parts.append(f'<rect class="box" x="30" y="{y - 22}" width="240" height="44" rx="2"/>')
        parts.append(f'<text class="mono" x="44" y="{y + 5}" font-size="13">{cmd}</text>')
        parts.append(row_wire(270, 660, y))
        parts.append(f'<rect class="box" x="660" y="{y - 22}" width="190" height="44" rx="2"/>')
        parts.append(f'<text x="674" y="{y + 5}" font-size="14">{target}</text>')
        parts.append(f'<text class="small faint" x="352" y="{y - 8}">{answer}</text>')
        o = 0.04 + i * 0.31
        if stop == 1:
            anim.append(mover(f"M270 {y} H334", o, o + 0.07))
            anim.append(cross(340, y, o + 0.07, o + 0.28))
        elif stop == 2:
            anim.append(mover(f"M270 {y} H574", o, o + 0.12))
            anim.append(cross(580, y, o + 0.12, o + 0.28))
        else:
            anim.append(mover(f"M270 {y} H656", o, o + 0.15))
            anim.append(f'<rect class="lit" x="656" y="{y - 26}" width="198" height="52" rx="5" opacity="0">{blink(o + 0.15, o + 0.28)}</rect>')
    body = f"""{header("IN AGENTS GENERALLY", "2 guards", "one says whether, one says how far")}
{"".join(parts)}
<text class="small muted" x="30" y="408">A wrong yes is stopped by the sandbox. A command that runs reaches only what it is meant to.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        432,
        "Two guards: a permission decides whether a command runs, and a sandbox decides what a running command may touch. rm -rf ~ is stopped at the permission, because you said no. cat ~/.ssh/id_ed25519 was allowed by mistake, and the sandbox stops it. pytest -q passes both and reaches the project.",
        body,
    )


# --- golem's shell sandbox, from one real run ---------------------------------------------

SHELL_ROWS = [
    ("touch notes.txt", "exit 0"),
    ("touch ~/golem-sandbox-probe", "Operation not permitted · exit 1"),
    ("ls ~/.ssh", "Operation not permitted · exit 1"),
    ("curl https://example.com", "Couldn't connect to server · exit 7"),
    ("printenv DEMO_API_KEY", "nothing printed · exit 1"),
]
OUTSIDE = [
    ("your home, for writes", "only the folder, temp, caches"),
    ("~/.ssh, ~/.golem, keychains", "no reads"),
    ("the network", "off unless [shell] network"),
    ("*_API_KEY, *_TOKEN, …", "removed from the environment"),
]
SHELL_Y = [180, 232, 284, 336, 388]
WALL_X = 520


def shell() -> str:
    parts = [
        f'<rect x="300" y="150" width="{WALL_X - 300}" height="262" rx="3" fill="var(--soft)"/>',
        '<text class="mono label" x="316" y="140">INSIDE THE SANDBOX</text>',
        '<text class="mono label" x="30" y="140">FIVE COMMANDS, ONE RUN</text>',
        f'<text class="mono label" x="{WALL_X + 30}" y="140">OUTSIDE</text>',
        f'<rect x="{WALL_X - 3}" y="150" width="6" height="262" rx="3" style="fill:var(--clay)" opacity=".55"/>',
        '<rect class="box" x="320" y="160" width="180" height="40" rx="2"/>',
        '<text x="334" y="185" font-size="14">the project folder</text>',
    ]
    for (cmd, _), y in zip(SHELL_ROWS, SHELL_Y, strict=True):
        parts.append(f'<rect class="box" x="30" y="{y - 20}" width="250" height="40" rx="2"/>')
        parts.append(f'<text class="mono" x="42" y="{y + 5}" font-size="12">{cmd}</text>')
    for (title, sub), y in zip(OUTSIDE, SHELL_Y[1:], strict=True):
        parts.append(row_wire(280, WALL_X + 30, y))
        parts.append(f'<rect class="box" x="{WALL_X + 30}" y="{y - 20}" width="{850 - WALL_X - 30}" height="40" rx="2"/>')
        parts.append(f'<text class="mono" x="{WALL_X + 42}" y="{y - 2}" font-size="12">{title}</text>')
        parts.append(f'<text class="small faint" x="{WALL_X + 42}" y="{y + 13}">{sub}</text>')
    parts.append(row_wire(280, 320, SHELL_Y[0]))
    anim = []
    for i, ((_, result), y) in enumerate(zip(SHELL_ROWS, SHELL_Y, strict=True)):
        o = 0.03 + i * 0.19
        anim.append(f'<rect class="lit" x="26" y="{y - 24}" width="258" height="48" rx="5" opacity="0">{blink(o, o + 0.17)}</rect>')
        if i == 0:
            anim.append(mover(f"M280 {y} H318", o + 0.01, o + 0.05))
            anim.append(f'<rect class="lit" x="316" y="156" width="188" height="48" rx="5" opacity="0">{blink(o + 0.05, o + 0.17)}</rect>')
        else:
            anim.append(mover(f"M280 {y} H{WALL_X - 6}", o + 0.01, o + 0.07))
            anim.append(cross(WALL_X, y, o + 0.07, o + 0.17))
        anim.append(shown(f'<text class="mono small clay" x="30" y="446">→ {result}</text>', o + 0.05, o + 0.17))
    body = f"""{header("ONE RUN IN GOLEM", "1 of 5", "got through: the write in the project")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        468,
        "golem's shell sandbox in one real run, with every command allowed by a rule. touch notes.txt writes in the project folder and exits 0. touch in the home folder and ls ~/.ssh fail with Operation not permitted, curl cannot connect because the network is off, and printenv prints nothing because credential variables are removed.",
        body,
    )


out = sys.argv[1]
for name, svg in [("sandbox-layers", layers()), ("sandbox-shell", shell())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
