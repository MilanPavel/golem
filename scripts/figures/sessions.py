"""Draws the figures of docs/architecture/sessions.md as animated SVGs.

- sessions-stores.svg: what survives. A window and the agent's process are gone after a close or a
  crash. The event log and the checkpoint, on disk, are not, so a new process and a new window
  pick up from them.
- sessions-ends.svg: three ways a run stops early in golem, a cancel, a shutdown, and a crash, and
  the one end they share: the partial answer, marked interrupted, then the run's end.
- sessions-fork.svg: a fork, cut from one session at one message id, in the log and the
  checkpoint at once. The real session from the chapter's trace.

Run from the repo root: python3 scripts/figures/sessions.py docs/images
"""

import sys

from svg import arrow_down, arrow_right, blink, card, facts, header, mover, outline, shown

END = 0.985


def box(x: int, y: int, w: int, h: int, title: str, sub: str = "", mono: bool = False) -> str:
    cls = ' class="mono"' if mono else ""
    out = f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>'
    out += f'<text{cls} x="{x + 14}" y="{y + 24}" font-size="14">{title}</text>'
    if sub:
        out += f'<text class="small faint" x="{x + 14}" y="{y + 42}">{sub}</text>'
    return out


def row(x: int, y: int, text: str, cls: str = "") -> str:
    return f'<text class="mono small {cls}" x="{x}" y="{y}">{text}</text>'


# --- What survives, in agents generally --------------------------------------------------

LOG_ROWS = [
    "#1  you: tell me a story",
    "#2  answer started",
    "#3  answer done: Once, a golem…",
    "#4  you: go on",
    "#5  answer done: That night…",
]
MEM_ROWS = [
    "user: tell me a story",
    "assistant: Once, a golem…",
    "user: go on",
    "assistant: That night…",
]


def stores() -> str:
    parts = [
        '<text class="mono label" x="30" y="146">IN A PROCESS: GONE ON A CRASH</text>',
        '<text class="mono label" x="470" y="146">ON DISK: KEPT</text>',
        '<path class="edge" d="M440 150 V430"/>',
        box(30, 166, 180, 56, "a window", "draws what happened"),
        box(30, 318, 180, 56, "the agent", "runs each turn"),
        '<path class="wire back" d="M120 318 V229"/><path class="head" d="M116 236 L120 229 L124 236 Z"/>',
        '<text class="small faint" x="130" y="276">events</text>',
        # The event log.
        '<rect class="box" x="470" y="166" width="380" height="132" rx="2"/>',
        '<text x="484" y="190" font-size="14">the event log</text>',
        '<text class="small faint" x="590" y="190">what was shown, numbered</text>',
        # The checkpoint.
        '<rect class="box" x="470" y="318" width="380" height="112" rx="2"/>',
        '<text x="484" y="342" font-size="14">the checkpoint</text>',
        '<text class="small faint" x="594" y="342">what the model reads next</text>',
        # Wires from the agent to both stores.
        '<path class="wire" d="M210 334 H420 V232 H467"/><path class="head" d="M460 228 L467 232 L460 236 Z"/>',
        '<path class="wire" d="M210 358 H467"/><path class="head" d="M460 354 L467 358 L460 362 Z"/>',
        '<text class="small faint" x="226" y="350">written first</text>',
    ]
    for i, text in enumerate(LOG_ROWS):
        parts.append(row(484, 212 + i * 18, text, "muted"))
    for i, text in enumerate(MEM_ROWS):
        parts.append(row(484, 364 + i * 18, text, "muted"))
    anim = [
        # A turn: both stores get its lines, the window draws them.
        mover("M210 334 H420 V232 H468", 0.02, 0.09),
        mover("M210 358 H468", 0.02, 0.09),
        outline(466, 162, 388, 140, 0.09, 0.16),
        outline(466, 314, 388, 120, 0.09, 0.16),
        mover("M120 318 V230", 0.10, 0.16),
        outline(26, 162, 188, 64, 0.16, 0.22),
        # The window closes. The agent goes on, and the next lines still land.
        f'<rect x="30" y="166" width="180" height="56" rx="2" fill="var(--sunken)" opacity="0">{blink(0.26, 0.62)}</rect>',
        shown('<text class="mono small clay" x="44" y="198">closed</text>', 0.26, 0.62),
        mover("M210 334 H420 V232 H468", 0.30, 0.37),
        mover("M210 358 H468", 0.30, 0.37),
        outline(466, 162, 388, 140, 0.37, 0.43),
        # The agent crashes.
        f'<rect x="30" y="318" width="180" height="56" rx="2" fill="var(--sunken)" opacity="0">{blink(0.46, 0.62)}</rect>',
        shown('<text class="mono small clay" x="44" y="350">crashed</text>', 0.46, 0.62),
        # A new process reads the checkpoint, a new window reads the log.
        shown('<text class="mono small clay" x="226" y="392">a new process reads it</text>', 0.64, END),
        mover("M467 380 H212", 0.64, 0.72),
        outline(26, 314, 188, 64, 0.72, 0.80),
        shown('<text class="mono small clay" x="226" y="250">a new window: after #3</text>', 0.80, END),
        mover("M467 212 H212", 0.80, 0.88),
        outline(26, 162, 188, 64, 0.88, 0.96),
    ]
    body = f"""{header("IN AGENTS GENERALLY", "on disk", "outlives the window and the process")}
{"".join(parts)}
<text class="small muted" x="30" y="466">The window can close and the process can die. A new one starts from the two files, not from scratch.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        492,
        "What survives. A window draws the events, and the agent runs each turn, but both live in a process and are gone after a close or a crash. Each turn is written first to two files on disk: the event log, what was shown, numbered, and the checkpoint, what the model reads next. The window closes and the agent keeps writing. Then the agent crashes. A new process reads the checkpoint, and a new window reads the log after the last number it had.",
        body,
    )


# --- Three early ends, in golem -----------------------------------------------------------

LANES = [
    (190, "Ctrl-C", "run.cancel", "seq 125", "seq 126", "run.cancelled", "user", False),
    (290, "golem daemon stop", "SIGTERM: drain", "", "", "run.cancelled", "shutdown", False),
    (390, "kill -9", "no daemon", "seq 865", "seq 866", "run.failed", "at the next start", True),
]
STREAM_X, STOP_X = 190, 400


def ends() -> str:
    parts = [
        '<text class="mono label" x="30" y="146">HOW IT STOPPED</text>',
        f'<text class="mono label" x="{STREAM_X}" y="146">THE ANSWER STREAMS</text>',
        '<text class="mono label" x="520" y="146">WHAT THE LOG GETS</text>',
    ]
    anim = []
    for i, (y, how, what, s1, s2, end, reason, crash) in enumerate(LANES):
        parts.append(f'<text class="mono" x="30" y="{y + 4}" font-size="13">{how}</text>')
        parts.append(f'<text class="small faint" x="30" y="{y + 22}">{what}</text>')
        # The stream: a row of small ticks, the deltas.
        for k in range(14):
            parts.append(f'<rect x="{STREAM_X + k * 15}" y="{y - 6}" width="9" height="12" rx="1" fill="var(--line)"/>')
        parts.append(f'<path class="wire" d="M{STOP_X} {y - 14} V{y + 14}" style="stroke:var(--clay);stroke-width:2"/>')
        tail = 472 if crash else 508
        if crash:
            parts.append(f'<path class="edge" d="M{STOP_X + 8} {y} H{tail + 40}"/>')
            parts.append(f'<text class="small faint" x="{STOP_X + 12}" y="{y + 22}">12 s, nothing runs</text>')
        else:
            parts.append(arrow_right(STOP_X + 8, 516, y))
        label = f"{s1} " if s1 else ""
        parts.append(f'<rect class="box" x="520" y="{y - 30}" width="330" height="62" rx="2"/>')
        parts.append(row(534, y - 10, f"{label}message.completed"))
        parts.append(row(534, y + 6, "interrupted: true, the text so far", "faint"))
        parts.append(row(534, y + 22, f"{s2 + ' ' if s2 else ''}{end} · {reason}", "clay"))
        o = 0.03 + i * 0.32
        anim.append(mover(f"M{STREAM_X} {y} H{STOP_X - 4}", o, o + 0.12))
        anim.append(shown(f'<text class="mono small clay" x="{STOP_X - 6}" y="{y - 20}" text-anchor="middle">stop</text>', o + 0.12, o + 0.30))
        wait = 0.07 if crash else 0.0
        anim.append(mover(f"M{STOP_X + 8} {y} H516", o + 0.13 + wait, o + 0.19 + wait))
        anim.append(outline(516, y - 34, 338, 70, o + 0.19 + wait, o + 0.30))
    parts.append(arrow_down(685, 422, 452))
    parts.append('<text class="small muted" x="685" y="470" text-anchor="middle">and the checkpoint gets the same text,</text>')
    parts.append('<text class="small muted" x="685" y="488" text-anchor="middle">so "go on" continues it</text>')
    body = f"""{header("THREE EARLY ENDS IN GOLEM", "one shape", "a cancel, a shutdown, a crash")}
{"".join(parts)}
<text class="small muted" x="30" y="488">Real seqs from one session with qwen3.5:4b.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        514,
        "Three ways a run stops early in golem, and the one end they share. Ctrl-C sends run.cancel: seq 125 is message.completed with interrupted true and the text so far, and seq 126 is run.cancelled with the reason user. golem daemon stop drains every run the same way, with the reason shutdown. After kill -9 nothing runs for 12 seconds, and at the next start recovery writes seq 865, the same interrupted message, and seq 866, run.failed. In every case the checkpoint gets the same partial text, so go on continues it.",
        body,
    )


# --- A fork, in golem ---------------------------------------------------------------------

SOURCE = [
    ("#2", "you", "a golem story"),
    ("#125", "golem", "…shaped like", True),
    ("#127", "you", "go on"),
    ("#762", "golem", "Chapter Three…"),
    ("#764", "you", "a second story"),
]
CUT_X = 300


def chip(x: int, y: int, seq: str, who: str, text: str, cut: bool = False, w: int = 124) -> str:
    out = f'<rect class="box" x="{x}" y="{y}" width="{w}" height="62" rx="2"'
    if cut:
        out += ' style="stroke:var(--clay);stroke-width:1.4"'
    out += "/>"
    out += row(x + 10, y + 20, seq, "faint")
    out += f'<text x="{x + 10}" y="{y + 38}" font-size="13">{who}</text>'
    out += f'<text class="small muted" x="{x + 10}" y="{y + 54}">{text}</text>'
    return out


def fork() -> str:
    parts = [
        '<text class="mono label" x="30" y="146">THE SOURCE · s_ecb0…</text>',
        '<text class="mono label" x="30" y="326">THE FORK · s_bd51…</text>',
    ]
    xs = [30, 166, 302, 438, 574]
    for x, item in zip(xs, SOURCE, strict=True):
        parts.append(chip(x, 160, item[0], item[1], item[2], len(item) > 3))
    parts.append(chip(710, 160, "#865", "golem", "winter… (crash)", w=140))
    cut = CUT_X
    parts.append(f'<path class="wire" d="M{cut - 4} 150 V244" style="stroke:var(--clay);stroke-width:2;stroke-dasharray:5 4"/>')
    parts.append(f'<text class="mono small clay" x="{cut + 4}" y="258">cut at m_fd51…, the interrupted reply</text>')
    fork_chips = [
        (248, "#2", "you", "a golem story", False, 124),
        (384, "#3", "golem", "…shaped like", True, 124),
        (520, "#4", "you", "what was it called?", False, 124),
        (656, "#168", "golem", 'Terrafol, "shaped like"', False, 194),
    ]
    for x, seq, who, text, c, w in fork_chips:
        parts.append(chip(x, 340, seq, who, text, c, w))
    parts.append('<rect class="box" x="30" y="340" width="206" height="62" rx="2"/>')
    parts.append(row(40, 360, "#1 session.created", "faint"))
    parts.append(row(40, 376, "forked_from: m_fd51…"))
    parts.append('<text class="small muted" x="40" y="394">logged before the copies</text>')
    parts.append('<path class="wire" d="M92 222 V300 H310 V337"/><path class="head" d="M306 331 L310 338 L314 331 Z"/>')
    parts.append('<path class="wire" d="M228 222 V280 H446 V337"/><path class="head" d="M442 331 L446 338 L450 331 Z"/>')
    parts.append('<text class="small faint" x="470" y="304">copied: a new seq, the same run_id</text>')
    parts.append(facts([
        "The model's side: the checkpoint whose last message is m_fd51…",
        "The screen's side: each message.completed up to and including it",
    ], 30, 446))
    anim = [
        outline(cut - 10, 152, 14, 96, 0.03, 0.14),
        outline(706, 156, 148, 70, 0.14, 0.22),
        shown('<text class="mono small clay" x="708" y="244">not copied</text>', 0.14, 0.30),
        outline(26, 336, 214, 70, 0.22, 0.32),
        mover("M92 222 V300 H310 V336", 0.32, 0.44),
        mover("M228 222 V280 H446 V336", 0.34, 0.46),
        outline(244, 336, 132, 70, 0.44, 0.52),
        outline(380, 336, 132, 70, 0.46, 0.54),
        outline(516, 336, 132, 70, 0.56, 0.66),
        outline(652, 336, 202, 70, 0.68, 0.86),
        shown('<text class="mono small clay" x="850" y="328" text-anchor="end">the fork remembers where it stopped</text>', 0.72, END),
    ]
    body = f"""{header("A FORK IN GOLEM", "one id", "cuts the log and the checkpoint")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        500,
        "A fork in golem, from the chapter's real session. The source has a story, the interrupted reply m_fd51 that ends with shaped like, go on, Chapter Three, a second story, and a reply cut by a crash. session.fork cuts at m_fd51. The fork's log starts with session.created and forked_from, then copies the two messages up to the cut with new seq numbers and the same run_id. Its checkpoint is the one whose last message is m_fd51. Asked what the golem was called, the fork answers Terrafol, and that the story stopped at shaped like. Nothing after the cut is copied.",
        body,
    )


out = sys.argv[1]
for name, svg in [("sessions-stores", stores()), ("sessions-ends", ends()), ("sessions-fork", fork())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
