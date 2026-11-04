"""Draws the figures of docs/architecture/context.md as animated SVGs.

- context-window.svg: three calls in one chat. Each call sends the whole context again: the
  system prompt, the tool list, the history so far, and the new message. The history grows
  toward the window's limit.
- context-build.svg: one model call in golem. The system prompt is built from its sections,
  put in front of the history for that call, and never stored. Only the reply goes back.
- context-pin.svg: one pinned skill over three real turns: read, edited, deleted.

Run from the repo root: python3 scripts/figures/context.py docs/images
"""

import sys

from svg import arrow_down, arrow_right, card, header, mover, outline, shown

# --- Every call sends it all, in agents generally -----------------------------------------

LAYERS = [
    ("system prompt", "who it is, its rules", "var(--soft)"),
    ("tool list", "each tool's name and schema", "var(--sunken)"),
    ("history", "every message so far", "var(--surface)"),
    ("your message", "the new turn", "var(--surface)"),
]
BAR_X = [300, 480, 660]
BAR_W = 150
BOTTOM = 384
LIMIT = 150
HEIGHTS = [[34, 40, 0, 28], [34, 40, 60, 28], [34, 40, 124, 28]]
HISTORY = ["", "2 messages", "4 messages"]
SHORT = ["system", "tools", "", "message"]


def window() -> str:
    legend = '<text class="mono label" x="30" y="150">IN EVERY CALL</text>'
    for i, (name, sub, fill) in enumerate(LAYERS):
        y = 184 + i * 50
        stroke = "var(--clay)" if i == 3 else "var(--line)"
        legend += (
            f'<rect x="30" y="{y - 14}" width="18" height="18" rx="2" fill="{fill}" stroke="{stroke}"/>'
            f'<text x="60" y="{y}" font-size="14">{name}</text>'
            f'<text class="small faint" x="60" y="{y + 17}">{sub}</text>'
        )
    bars = (
        f'<path class="edge" d="M290 {LIMIT} H830"/>'
        f'<text class="small faint" x="830" y="{LIMIT - 8}" text-anchor="end">the window\'s limit</text>'
    )
    anim = []
    for c, (x, heights) in enumerate(zip(BAR_X, HEIGHTS, strict=True)):
        top = BOTTOM - sum(heights)
        y = top
        o = 0.04 + c * 0.32
        for j, ((name, _, fill), h) in enumerate(zip(LAYERS, heights, strict=True)):
            if h == 0:
                continue
            stroke = "var(--clay)" if j == 3 else "var(--line)"
            bars += f'<rect x="{x}" y="{y}" width="{BAR_W}" height="{h}" fill="{fill}" stroke="{stroke}"/>'
            label = HISTORY[c] if j == 2 else SHORT[j]
            bars += f'<text class="small muted" x="{x + BAR_W / 2}" y="{y + h / 2 + 4}" text-anchor="middle">{label}</text>'
            anim.append(outline(x - 3, y - 3, BAR_W + 6, h + 6, o + j * 0.035, o + j * 0.035 + 0.05))
            y += h
        bars += f'<text class="mono label" x="{x + BAR_W / 2}" y="{BOTTOM + 24}" text-anchor="middle">CALL {c + 1}</text>'
        anim.append(outline(x - 5, top - 5, BAR_W + 10, BOTTOM - top + 10, o + 0.15, o + 0.29))
        anim.append(shown(f'<text class="mono small clay" x="{x + BAR_W / 2}" y="{top - 12}" text-anchor="middle">→ the model</text>', o + 0.15, o + 0.29))
    body = f"""{header("IN AGENTS GENERALLY", "every call", "the whole context, sent again")}
{legend}{bars}
<text class="small muted" x="30" y="446">Nothing carries over between calls. Each one sends it all again, and the history grows toward the limit.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        472,
        "Three calls in one chat. Each call sends the whole context again: the system prompt, the tool list, the history so far, and the new message. The history grows from none to two to four messages, toward the window's limit.",
        body,
    )


# --- One call in golem: built, sent, not stored -------------------------------------------


def box(x: float, y: float, w: float, h: float, title: str, sub: str, mono: bool = True) -> str:
    cls = "mono" if mono else ""
    return (
        f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>'
        f'<text class="{cls}" x="{x + 14}" y="{y + h / 2 - 3}" font-size="13">{title}</text>'
        f'<text class="small faint" x="{x + 14}" y="{y + h / 2 + 14}">{sub}</text>'
    )


def build() -> str:
    parts = [
        '<text class="mono label" x="30" y="140">WHAT IT READS</text>',
        box(30, 152, 200, 52, "sessions.skills", "the pins: terse"),
        box(30, 226, 200, 52, "terse/SKILL.md", "read again for every call"),
        box(30, 316, 200, 52, "checkpoint", "the messages, no prompt"),
        '<text class="mono label" x="290" y="140">BUILT FOR THIS CALL</text>',
        '<rect class="box" x="290" y="152" width="200" height="126" rx="2"/>',
        '<text class="mono" x="304" y="178" font-size="13">SystemPrompt</text>',
        '<text class="small faint" x="304" y="198">its sections, in order</text>',
        '<rect x="304" y="212" width="172" height="50" rx="2" fill="var(--soft)"/>',
        '<text class="mono small" x="316" y="232">pinned skills</text>',
        '<text class="small faint" x="316" y="250">the one section today</text>',
        arrow_right(230, 287, 178),
        arrow_right(230, 301, 252),
        '<text class="small faint" x="290" y="302">session.inspect builds the same,</text>',
        '<text class="small faint" x="290" y="320">so /debug model shows it</text>',
        '<text class="mono label" x="550" y="140">ONE MODEL CALL</text>',
        '<rect x="550" y="196" width="150" height="40" rx="2" fill="var(--soft)" stroke="var(--line)"/>',
        '<text class="mono small" x="564" y="221">system message</text>',
        '<rect x="550" y="236" width="150" height="62" rx="2" class="box" stroke="var(--line)"/>',
        '<text class="mono small" x="564" y="262">history</text>',
        '<text class="small faint" x="564" y="280">from the checkpoint</text>',
        arrow_right(490, 547, 216),
        '<path class="wire" d="M230 342 H520 V276 H546"/><path class="head" d="M540 272 L547 276 L540 280 Z"/>',
        arrow_right(700, 757, 246),
        '<rect class="box" x="760" y="218" width="90" height="56" rx="2"/>',
        '<text class="mono label" x="805" y="251" text-anchor="middle">MODEL</text>',
        '<path class="wire back" d="M805 274 V404 H130 V370"/><path class="head" d="M126 377 L130 370 L134 377 Z"/>',
        '<text class="small faint" x="470" y="398" text-anchor="middle">only the reply is stored</text>',
    ]
    anim = [
        outline(26, 148, 208, 60, 0.03, 0.14),
        mover("M230 178 H288", 0.08, 0.13),
        outline(26, 222, 208, 60, 0.13, 0.24),
        mover("M230 252 H302", 0.18, 0.23),
        outline(286, 148, 208, 134, 0.23, 0.36),
        mover("M490 216 H548", 0.31, 0.36),
        outline(26, 312, 208, 60, 0.36, 0.47),
        mover("M230 342 H520 V276 H548", 0.40, 0.47),
        outline(546, 192, 158, 110, 0.47, 0.60),
        mover("M700 246 H758", 0.55, 0.60),
        outline(756, 214, 98, 64, 0.60, 0.70),
        mover("M805 274 V404 H130 V370", 0.68, 0.80),
        outline(26, 312, 208, 60, 0.80, 0.90),
        shown('<text class="mono small clay" x="550" y="322">system message: dropped</text>', 0.70, 0.90),
    ]
    body = f"""{header("ONE CALL IN GOLEM", "per call", "built fresh, never stored")}
{"".join(parts)}
<text class="small muted" x="30" y="440">An edit to the skill shows on the next call. The checkpoint holds only what was said.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        466,
        "One model call in golem. The SystemPrompt reads the session's pins and each pinned SKILL.md, and builds the system message. It goes in front of the history from the checkpoint, for this one call. Only the model's reply is stored, so the checkpoint never holds the prompt. session.inspect builds the same prompt, so /debug model shows it.",
        body,
    )


# --- One pin over three real turns --------------------------------------------------------

TURNS = [
    ("PIN, THEN ASK", 'start it with "In short:"', "seq 82 · skill.activated", "pinned · hash 1fef4516…", "What is a daemon?",
     ["In short: A daemon is a", "background process that runs", "continuously …"]),
    ("EDIT THE FILE", 'start it with "Briefly:"', "seq 125 · skill.activated", "the new hash 4bb7077a…", "And what is a socket?",
     ["Briefly: A socket is a software", "endpoint that allows", "communication between …"]),
    ("DELETE IT", "the folder is gone", "seq 170 · skill.skipped", "missing · still pinned", "And a pid file?",
     ["A PID file (Process Identifier", "file) is a file used by …", "1. Track the process ID …"]),
]
TX = [30, 310, 590]
TW = 260


def pin() -> str:
    parts = []
    anim = []
    for i, ((title, file, event, detail, question, answer), x) in enumerate(zip(TURNS, TX, strict=True)):
        parts.append(f'<text class="mono label" x="{x}" y="142">{i + 1} · {title}</text>')
        parts.append(box(x, 154, TW, 52, "terse/SKILL.md", file))
        parts.append(arrow_down(x + TW / 2, 206, 226))
        parts.append(f'<rect x="{x}" y="228" width="{TW}" height="52" rx="2" fill="var(--soft)"/>')
        parts.append(f'<text class="mono small" x="{x + 14}" y="250" style="fill:var(--clay-ink)">{event}</text>')
        parts.append(f'<text class="small faint" x="{x + 14}" y="268">{detail}</text>')
        parts.append(arrow_down(x + TW / 2, 280, 300))
        parts.append(f'<rect class="box" x="{x}" y="302" width="{TW}" height="104" rx="2"/>')
        parts.append(f'<text class="mono small faint" x="{x + 14}" y="324">{question}</text>')
        for j, line in enumerate(answer):
            parts.append(f'<text x="{x + 14}" y="{348 + j * 19}" font-size="13">{line}</text>')
        o = 0.04 + i * 0.32
        anim.append(outline(x - 4, 150, TW + 8, 60, o, o + 0.08))
        anim.append(mover(f"M{x + TW / 2} 206 V226", o + 0.06, o + 0.09))
        anim.append(outline(x - 4, 224, TW + 8, 60, o + 0.09, o + 0.17))
        anim.append(mover(f"M{x + TW / 2} 280 V300", o + 0.15, o + 0.18))
        anim.append(outline(x - 4, 298, TW + 8, 112, o + 0.18, o + 0.29))
    body = f"""{header("ONE SESSION IN GOLEM", "3 turns", "one pin, read again for every call")}
{"".join(parts)}
<text class="small muted" x="30" y="440">Real events from one session with qwen3-coder:30b. The log says what the model read, once per change.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        466,
        "One pinned skill over three real turns. Pinned, terse says to start with In short:, and the answer does. After an edit to Briefly:, the next call logs skill.activated with the new hash, and the answer starts with Briefly:. After the folder is deleted, the call logs skill.skipped, missing, and the answer is long again. The skill stays pinned.",
        body,
    )


out = sys.argv[1]
for name, svg in [("context-window", window()), ("context-build", build()), ("context-pin", pin())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
