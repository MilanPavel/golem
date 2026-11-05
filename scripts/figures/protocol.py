"""Draws the figures of docs/architecture/protocol.md as animated SVGs.

- protocol-two-ways.svg: the two directions. A command has an id and gets one reply. An event is
  a numbered fact with no reply. After a dropped connection, the client asks for what came
  after the last number it has.
- protocol-attach.svg: the real two-window trace. A attaches first and gets every event live.
  B attaches 6 s in: seq 1 to 9 come as one replay, then the reply says last_seq 9, then both
  get seq 10 to 43 in the same millisecond.
- protocol-one-shape.svg: the shapes are Python classes; just gen writes JSON Schema and
  TypeScript; one client reaches the daemon over a Unix socket, or from a browser through the
  gateway, as the same lines.

Run from the repo root: python3 scripts/figures/protocol.py docs/images
"""

import sys

from svg import arrow_down, arrow_left, arrow_right, blink, card, header, mover, outline, shown

END = 0.985


def box(x: int, y: int, w: int, h: int, title: str, sub: str = "", mono: bool = False) -> str:
    cls = ' class="mono"' if mono else ""
    out = f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>'
    out += f'<text{cls} x="{x + 14}" y="{y + 24}" font-size="14">{title}</text>'
    if sub:
        out += f'<text class="small faint" x="{x + 14}" y="{y + 42}">{sub}</text>'
    return out


# --- Two directions, in agents generally --------------------------------------------------

CX, AX = 250, 720
# (y, to the agent?, the line, a note on the left, dashed)
LINES = [
    (176, True, '{"id":4, "method":"send", …}', "a command asks", False),
    (206, False, '{"id":4, "result":{"run":"r_7"}}', "and gets one reply", False),
    (246, False, "event #41  a token", "events tell, in order,", False),
    (272, False, "event #42  a token", "numbered, with no reply", False),
    (370, True, "attach, after #41", "it asks from its number", False),
    (400, False, "event #42  again", "and the rest comes again", True),
    (426, False, "event #43  done", "", False),
]


def two_ways() -> str:
    parts = [
        f'<text class="mono label" x="{CX}" y="146" text-anchor="middle">A CLIENT</text>',
        f'<text class="mono label" x="{AX}" y="146" text-anchor="middle">THE AGENT</text>',
        f'<path class="wire" d="M{CX} 156 V440"/>',
        f'<path class="wire" d="M{AX} 156 V440"/>',
        f'<text class="small faint" x="{AX + 12}" y="290">keeps every</text>',
        f'<text class="small faint" x="{AX + 12}" y="306">event, numbered</text>',
        # The drop.
        f'<path d="M{CX - 18} 314 L{CX + 18} 340 M{CX + 18} 314 L{CX - 18} 340" style="stroke:var(--clay);stroke-width:2"/>',
        '<text class="small muted" x="30" y="332">the connection drops</text>',
    ]
    anim = []
    for i, (y, out, text, note, dashed) in enumerate(LINES):
        cls = "wire back" if dashed else "wire"
        if out:
            parts.append(f'<path class="{cls}" d="M{CX} {y} H{AX - 1}"/><path class="head" d="M{AX - 7} {y - 4} L{AX} {y} L{AX - 7} {y + 4} Z"/>')
            path = f"M{CX} {y} H{AX}"
        else:
            parts.append(f'<path class="{cls}" d="M{AX} {y} H{CX + 1}"/><path class="head" d="M{CX + 7} {y - 4} L{CX} {y} L{CX + 7} {y + 4} Z"/>')
            path = f"M{AX} {y} H{CX}"
        parts.append(f'<text class="mono small" x="{(CX + AX) // 2}" y="{y - 6}" text-anchor="middle">{text}</text>')
        if note:
            parts.append(f'<text class="small muted" x="30" y="{y + 4}">{note}</text>')
        o = [0.03, 0.12, 0.24, 0.32, 0.58, 0.70, 0.78][i]
        anim.append(mover(path, o, o + 0.08))
    anim.append(f'<path d="M{CX - 18} 314 L{CX + 18} 340 M{CX + 18} 314 L{CX - 18} 340" style="stroke:var(--clay);stroke-width:4" opacity="0">{blink(0.44, 0.56)}</path>')
    anim.append(outline(AX - 8, 160, 16, 280, 0.62, 0.70))
    body = f"""{header("IN AGENTS GENERALLY", "2 ways", "commands ask, events tell")}
{"".join(parts)}
<text class="small muted" x="30" y="470">A number on each event is what makes a reconnect lose nothing and repeat nothing.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        496,
        "The two directions of a protocol between a client and an agent. A command has an id and gets one reply with the same id. Events are facts, in order, each with a number, and get no reply. When the connection drops, the client asks for everything after the last number it has, number 41, and gets 42 again and then 43.",
        body,
    )


# --- Attach, in golem: the real two-window trace -------------------------------------------

X0, STEP = 200, 14.6
ROWS = [(172, "golem.db"), (232, "A · tui"), (292, "B · web")]


def x_of(seq: int) -> float:
    return X0 + (seq - 1) * STEP


def attach() -> str:
    parts = [
        '<text class="mono label" x="30" y="146">SEQ 1 TO 43 OF ONE SESSION</text>',
    ]
    for y, name in ROWS:
        parts.append(f'<text class="mono" x="30" y="{y + 5}" font-size="13">{name}</text>')
        for s in range(1, 44):
            parts.append(f'<rect x="{x_of(s) - 5}" y="{y - 7}" width="10" height="14" rx="1" fill="var(--line)" opacity=".45"/>')
    # The labels under the rows.
    parts.append(f'<text class="small faint" x="{x_of(1) - 5}" y="200">1 created · 2–4 your line, run, answer started · 5–41 deltas · 42 done · 43 run</text>')
    parts.append(f'<path class="wire" d="M{x_of(9) + 7} 280 V320" style="stroke:var(--clay);stroke-width:1.6"/>')
    parts.append(f'<text class="mono small clay" x="{x_of(9) + 12}" y="338">6.081 s: attach, after_seq 0 → last_seq 9</text>')
    parts.append(f'<text class="small faint" x="{x_of(1) - 5}" y="320">1–9: the replay</text>')
    parts.append(f'<text class="small faint" x="{x_of(26)}" y="270">10–43: live, to A and B</text>')
    anim = []
    # Each seq lights in the log, then reaches A; B gets 1–9 in one burst, then lives with A.
    for s in range(1, 44):
        if s <= 4:
            t = 0.02 + s * 0.012
        elif s <= 9:
            t = 0.20 + (s - 5) * 0.02
        else:
            t = 0.42 + (s - 10) * 0.014
        x = x_of(s)
        for y in (172, 232):
            anim.append(f'<rect x="{x - 5}" y="{y - 7}" width="10" height="14" rx="1" class="dot" opacity="0">{blink(t, END)}</rect>')
        tb = 0.36 if s <= 9 else t
        anim.append(f'<rect x="{x - 5}" y="285" width="10" height="14" rx="1" class="dot" opacity="0">{blink(tb, END)}</rect>')
    anim.append(outline(x_of(1) - 10, 280, x_of(9) - x_of(1) + 20, 24, 0.36, 0.42))
    facts_y = 396
    lines = [
        "Real, from a throwaway daemon with qwen3.5:4b: B's hello, then session.attach with after_seq 0.",
        "The replay, seq 1 to 9, and the reply came at 6.083 s. Seq 10 reached A and B at 6.092 s.",
        "Neither window got an event twice, or missed one.",
    ]
    for i, line in enumerate(lines):
        parts.append(f'<text class="small muted" x="30" y="{facts_y + i * 20}">{line}</text>')
    body = f"""{header("ATTACH IN GOLEM", "no gap", "and no duplicate")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        470,
        "The real two-window trace. The log numbers 43 events of one session. A, the TUI, attached first and gets each one live. B, a web page, connects 6.081 seconds in and attaches with after_seq 0. Seq 1 to 9 come to it as one replay, then the reply says last_seq 9. From seq 10 on, A and B get each event in the same millisecond. Neither gets an event twice, or misses one.",
        body,
    )


# --- One shape, in golem ------------------------------------------------------------------


def one_shape() -> str:
    parts = [
        box(30, 150, 200, 56, "golem_protocol", "Python classes: the source", mono=True),
        arrow_right(230, 297, 178),
        '<text class="mono small" x="264" y="170" text-anchor="middle">just gen</text>',
        box(300, 150, 230, 56, "packages/protocol/gen", "per message: schema + .ts", mono=True),
        arrow_right(530, 567, 178),
        box(570, 150, 280, 56, "@golem/client", "one client, two links", mono=True),
        arrow_down(130, 206, 292),
        '<text class="small faint" x="140" y="254">the same classes</text>',
        '<rect class="box" x="30" y="294" width="220" height="150" rx="2" style="fill:var(--soft)"/>',
        '<text x="44" y="318" font-size="14">the daemon</text>',
        '<text class="small faint" x="44" y="336">reads each line into</text>',
        '<text class="small faint" x="44" y="352">a class, or answers an error</text>',
        '<text class="mono small" x="44" y="380">run/golem.sock</text>',
        '<text class="small faint" x="44" y="398">mode 0600, no port</text>',
    ]
    clients = [(570, 76, "the TUI"), (654, 100, "golem status"), (762, 88, "a web page")]
    for x, w, name in clients:
        parts.append(arrow_down(x + w // 2, 206, 256))
        parts.append(f'<rect class="box" x="{x}" y="258" width="{w}" height="40" rx="2"/>')
        parts.append(f'<text x="{x + 10}" y="283" font-size="13">{name}</text>')
    # The Unix socket from the TUI and golem status.
    parts.append('<path class="wire" d="M608 298 V340 M704 298 V340 M704 340 H253"/><path class="head" d="M260 336 L253 340 L260 344 Z"/>')
    parts.append('<text class="small faint" x="270" y="332">unix-link: the socket, one JSON object per line</text>')
    # The web page through the gateway.
    parts.append(arrow_down(806, 298, 380))
    parts.append('<text class="small faint" x="736" y="324">WebSocket</text>')
    parts.append('<rect class="box" x="620" y="382" width="230" height="56" rx="2"/>')
    parts.append('<text class="mono" x="634" y="406" font-size="14">golem web</text>')
    parts.append('<text class="small faint" x="634" y="424">the gateway: token, Origin, methods</text>')
    parts.append(arrow_left(620, 253, 410))
    parts.append('<text class="small faint" x="270" y="402">the same line, never re-written</text>')
    anim = [
        outline(26, 146, 208, 64, 0.02, 0.10),
        mover("M230 178 H298", 0.08, 0.12),
        outline(296, 146, 238, 64, 0.12, 0.20),
        mover("M530 178 H568", 0.18, 0.22),
        outline(566, 146, 288, 64, 0.22, 0.30),
        mover("M130 206 V292", 0.10, 0.20),
        mover("M608 298 V340 H254", 0.34, 0.46),
        mover("M704 298 V340 H254", 0.38, 0.50),
        outline(26, 290, 228, 158, 0.46, 0.56),
        mover("M806 298 V380", 0.58, 0.66),
        outline(616, 378, 238, 64, 0.66, 0.76),
        mover("M620 410 H254", 0.76, 0.86),
        outline(26, 290, 228, 158, 0.86, 0.96),
    ]
    body = f"""{header("ONE SHAPE IN GOLEM", "1 source", "for the daemon and every client")}
{"".join(parts)}
<text class="small muted" x="30" y="476">Change a class, run just gen, and the TypeScript changes with it. just check fails if it did not.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        500,
        "One shape for the daemon and every client. The messages are Python classes in golem_protocol. just gen writes a JSON Schema and a TypeScript file for each message into packages/protocol/gen, and @golem/client uses them. The TUI and golem status reach the daemon over the Unix socket, one JSON object per line. A web page reaches it over a WebSocket through golem web, the gateway, which checks the token, the Origin, and the method, and passes the same line on. The daemon reads each line into the same Python classes.",
        body,
    )


out = sys.argv[1]
for name, svg in [("protocol-two-ways", two_ways()), ("protocol-attach", attach()), ("protocol-one-shape", one_shape())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
