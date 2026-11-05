"""Draws the figures of docs/architecture/tui.md as animated SVGs.

- tui-fold.svg: a screen as a fold over events. Numbered events go through one function into a
  small state, and the state is painted. Live, replayed, or after a reconnect, the same events
  give the same screen.
- tui-layers.svg: golem's three packages, from the socket up: @golem/client keeps the link and
  the last seq, @golem/view folds the events, @golem/tui paints. The web UI reuses the lower two.
- tui-keys.svg: a line from the keys to the screen, as a sequence over time.
- tui-bands.svg: the screen top to bottom, in three moments: idle, a reply streaming, and a tool
  call waiting for approval.

Run from the repo root: python3 scripts/figures/tui.py docs/images
"""

import sys

from svg import arrow_down, arrow_left, arrow_right, arrow_up, blink, card, facts, header, mover, outline, shown

END = 0.985


def box(x: int, y: int, w: int, h: int, title: str, sub: str = "", mono: bool = False, soft: bool = False) -> str:
    cls = ' class="mono"' if mono else ""
    fill = ' style="fill:var(--soft)"' if soft else ""
    out = f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"{fill}/>'
    out += f'<text{cls} x="{x + 14}" y="{y + 24}" font-size="14">{title}</text>'
    if sub:
        out += f'<text class="small faint" x="{x + 14}" y="{y + 42}">{sub}</text>'
    return out


def group(inner: str, start: float, end: float) -> str:
    return f'<g opacity="0">{blink(start, end)}{inner}</g>'


# --- A screen is a fold, in agents generally ------------------------------------------------

EVENTS = [
    "1 session.created",
    "2 message.completed",
    "3 run.started",
    "4 message.started",
    "5 message.delta",
    "6 message.delta",
    "… 190 more deltas",
    "197 message.completed",
    "198 run.completed",
]


def fold() -> str:
    parts = [
        '<text class="mono label" x="30" y="140">THE EVENTS</text>',
        '<text class="mono label" x="290" y="140">ONE FUNCTION</text>',
        '<text class="mono label" x="470" y="140">THE STATE</text>',
        '<text class="mono label" x="670" y="140">THE SCREEN</text>',
    ]
    for i, name in enumerate(EVENTS):
        y = 156 + i * 26
        parts.append(f'<rect class="box" x="30" y="{y}" width="210" height="22" rx="2"/>')
        parts.append(f'<text class="mono small" x="42" y="{y + 15}">{name}</text>')
    parts.append(box(290, 230, 140, 74, "fold", "state + event", soft=True))
    parts.append('<text class="small faint" x="304" y="290">→ new state</text>')
    parts.append(arrow_right(240, 288, 267))
    parts.append(
        '<rect class="box" x="470" y="156" width="160" height="226" rx="2"/>'
        '<text class="mono small" x="484" y="182">messages</text>'
        '<text class="small faint" x="484" y="200">id, role, text, streaming</text>'
        '<text class="mono small" x="484" y="232">busy</text>'
        '<text class="small faint" x="484" y="250">a run is working</text>'
        '<text class="mono small" x="484" y="282">approval</text>'
        '<text class="small faint" x="484" y="300">a call that waits</text>'
        '<text class="mono small" x="484" y="332">error, notice</text>'
        '<text class="small faint" x="484" y="350">the red and yellow lines</text>'
    )
    parts.append(arrow_right(430, 468, 267))
    parts.append(
        '<rect class="box" x="670" y="156" width="180" height="226" rx="2"/>'
        '<text class="mono small" x="684" y="184">you</text>'
        '<text class="small" x="684" y="202">Tell a short story</text>'
        '<text class="mono small" x="684" y="234">golem</text>'
        '<text class="small" x="684" y="252">Once, a golem of</text>'
        '<text class="small" x="684" y="270">river clay found a</text>'
        '<text class="small" x="684" y="288">brush by the kiln…</text>'
        '<path class="wire" d="M684 350 H836"/>'
        '<text class="mono small faint" x="684" y="370">connected · 3 messages</text>'
    )
    parts.append(arrow_right(630, 668, 267))
    parts.append('<text class="small faint" x="470" y="400">kept</text>')
    parts.append('<text class="small faint" x="670" y="400">painted again, then thrown away</text>')
    parts.append(facts([
        "Live, replayed from 1, or resumed after a drop: the same events give the same screen",
        "The screen keeps the state, never the events. A late window reads them again",
    ], 30, 438))
    anim = []
    for k, i in enumerate([0, 1, 2, 3, 4, 5, 7, 8]):
        a = 0.04 + k * 0.1
        y = 156 + i * 26 + 11
        anim.append(outline(28, 156 + i * 26 - 2, 214, 26, a, a + 0.08))
        anim.append(mover(f"M240 {y} H264 V267 H290", a, a + 0.03))
        anim.append(mover("M430 267 H470", a + 0.04, a + 0.06))
        anim.append(mover("M630 267 H670", a + 0.06, a + 0.08))
    anim.append(outline(466, 152, 168, 234, 0.82, 0.96))
    body = f"""{header("IN AGENTS GENERALLY", "fold", "a screen is drawn from events")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        490,
        "A screen as a fold over events. The numbered events of one session, from session.created to run.completed, go one at a time through one function that takes the state and an event and gives a new state. The state is small: the messages, whether a run is busy, a call that waits for approval, and the error and notice lines. The screen is painted from that state and thrown away. Live, replayed from the first event, or resumed after a drop, the same events give the same screen.",
        body,
    )


# --- The three packages, in golem -------------------------------------------------------------

LAYERS = [
    (130, "@golem/tui", "Ink 8 and React 19: the bands, the keys, the layout, painted from the state"),
    (226, "@golem/view", "reduceChat, the 16 ms delta batcher, the composer and its commands, the setup window"),
    (322, "@golem/client", "hello, a ping every 5 s, reconnect from 200 ms up to 5 s, attach after the last seq"),
]


def layers() -> str:
    parts = []
    for y, name, sub in LAYERS:
        parts.append(box(30, y, 580, 64, name, sub, mono=True))
    parts.append(box(30, 418, 580, 44, "golem.sock", "", mono=True))
    parts.append('<text class="small faint" x="160" y="446">one JSON line per event, to the daemon</text>')
    for y in (194, 290, 386):
        parts.append(arrow_up(320, y + 24, y + 2))
    parts.append('<text class="small faint" x="332" y="212">the state</text>')
    parts.append('<text class="small faint" x="332" y="308">each new event</text>')
    parts.append('<text class="small faint" x="332" y="404">every event line</text>')
    # The web UI on the side, for the next chapter.
    parts.append('<rect x="650" y="130" width="200" height="64" rx="2" fill="none" class="edge"/>')
    parts.append('<text class="mono" x="664" y="154" font-size="14">@golem/web</text>')
    parts.append('<text class="small faint" x="664" y="172">the browser, chapter 13</text>')
    parts.append('<path class="wire back" d="M750 194 V258 H613"/><path class="head" d="M620 254 L613 258 L620 262 Z"/>')
    parts.append('<path class="wire back" d="M750 258 V354 H613"/><path class="head" d="M620 350 L613 354 L620 358 Z"/>')
    parts.append('<text class="small faint" x="660" y="248">the same fold</text>')
    parts.append('<text class="small faint" x="660" y="344">the same client, over a WebSocket</text>')
    parts.append(facts([
        "A window drew 192 deltas as 158 updates. A late one drew 16 replayed deltas as one",
        "Dropped at seq 44: back in 25 ms, attached after 44, and seq 45 came next",
    ], 30, 500))
    anim = [
        mover("M320 418 V386", 0.04, 0.10),
        outline(26, 318, 588, 72, 0.10, 0.22),
        shown('<text class="mono small clay" x="470" y="346">seq 45 &gt; 44: keep</text>', 0.10, 0.22),
        mover("M320 322 V290", 0.22, 0.28),
        outline(26, 222, 588, 72, 0.28, 0.40),
        shown('<text class="mono small clay" x="470" y="250">fold it</text>', 0.28, 0.40),
        mover("M320 226 V194", 0.40, 0.46),
        outline(26, 126, 588, 72, 0.46, 0.58),
        shown('<text class="mono small clay" x="470" y="154">paint</text>', 0.46, 0.58),
        # A repeat after a reconnect stops at the client.
        mover("M320 418 V386", 0.66, 0.72),
        outline(26, 318, 588, 72, 0.72, 0.90),
        shown('<text class="mono small clay" x="400" y="346">seq 44 ≤ 44: dropped, a repeat</text>', 0.72, 0.90),
    ]
    body = f"""{header("THE PACKAGES, IN GOLEM", "3", "a link, a fold, a paint")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        548,
        "golem's terminal app in three packages, from the socket up. @golem/client keeps the link: hello, a ping every 5 seconds, a reconnect that waits from 200 milliseconds up to 5 seconds, and an attach after the last seq it delivered, so a repeat is dropped. @golem/view folds each new event into the chat with reduceChat, and batches deltas for 16 milliseconds. @golem/tui paints the state with Ink and React. The web UI, the next chapter, uses the same view and client over a WebSocket. Real: a window drew 192 deltas as 158 updates, and a late window drew 16 replayed deltas as one. A link dropped at seq 44 was back in 25 milliseconds, attached after 44, and seq 45 came next.",
        body,
    )


# --- A line from the keys to the screen, in golem ---------------------------------------------

LANES = [(80, "you"), (300, "App"), (520, "client"), (760, "daemon")]


def keys() -> str:
    parts = []
    for x, name in LANES:
        parts.append(f'<rect class="box" x="{x - 60}" y="126" width="120" height="32" rx="2"/>')
        parts.append(f'<text class="mono" x="{x}" y="147" font-size="14" text-anchor="middle">{name}</text>')
        parts.append(f'<path class="edge" d="M{x} 158 V490"/>')
    rows = [
        # (y, from, to, label, back)
        (186, 80, 300, "Enter", False),
        (252, 300, 520, "sendMessage", False),
        (282, 520, 760, "message.send", False),
        (312, 760, 520, "result: run_id, no text yet", True),
        (344, 760, 300, "message.completed: your line", True),
        (372, 760, 300, "message.delta × 192", True),
        (462, 760, 300, "message.completed, run.completed", True),
    ]
    for y, a, b, label, back in rows:
        if a < b:
            parts.append(arrow_right(a, b, y))
        else:
            parts.append(arrow_left(a, b, y, back=back))
        lx = min(a, b) + 14
        parts.append(f'<text class="mono small" x="{lx}" y="{y - 7}">{label}</text>')
    # applyComposer, a step inside App.
    parts.append('<rect class="box" x="236" y="200" width="128" height="26" rx="2" style="fill:var(--soft)"/>')
    parts.append('<text class="mono small" x="248" y="217">applyComposer</text>')
    parts.append('<text class="small faint" x="372" y="217">/ is a command, the rest is text</text>')
    # The batcher.
    parts.append('<rect class="box" x="236" y="386" width="128" height="44" rx="2" style="fill:var(--soft)"/>')
    parts.append('<text class="mono small" x="248" y="404">16 ms</text>')
    parts.append('<text class="small faint" x="248" y="421">158 updates</text>')
    anim = []
    t = 0.03
    for y, a, b, _label, _back in rows:
        d = 0.07 if abs(a - b) > 300 else 0.05
        anim.append(mover(f"M{a} {y} H{b}", t, t + d))
        t += d + 0.04
        if y == 186:
            anim.append(outline(232, 196, 136, 34, t, t + 0.06))
            t += 0.07
    anim.append(outline(232, 382, 136, 52, 0.62, 0.78))
    body = f"""{header("A LINE, IN GOLEM", "Enter", "from the keys to the screen")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        520,
        "A line from the keys to the screen. You press Enter. applyComposer in App decides: a line that starts with a slash is a local command, the rest is text. App calls sendMessage, and the client sends message.send. The daemon answers only with the run id. Your line appears when message.completed comes back. Then 192 message.delta events arrive, and a 16 millisecond batcher turns them into 158 screen updates. message.completed and run.completed end the reply.",
        body,
    )


# --- The screen, top to bottom, in golem ------------------------------------------------------

FX, FW = 230, 420


def band(y: int, h: int, text: str, name: str, cls: str = "small", fill: str = "") -> str:
    style = f' style="fill:var({fill})"' if fill else ""
    return (
        f'<rect class="box" x="{FX}" y="{y}" width="{FW}" height="{h}" rx="1"{style}/>'
        f'<text class="mono {cls}" x="{FX + 12}" y="{y + h / 2 + 4}">{text}</text>'
        f'<text class="small faint" x="{FX + FW - 10}" y="{y + h / 2 + 4}" text-anchor="end">{name}</text>'
    )


def frame(meter: str, approval: bool, composer: str, status: str, last: str) -> str:
    out = [f'<rect x="{FX - 8}" y="122" width="{FW + 16}" height="356" rx="6" fill="var(--sunken)"/>']
    out.append(band(130, 52, "█ golem  0.8.0 · qwen3.5:4b · ~/notes", "header"))
    bottom = 470
    rows = []
    rows.append((22, status, "status", "small faint", ""))
    rows.append((30, composer, "composer", "small", ""))
    if approval:
        rows.append((60, "Allow read_file notes.txt?  a allow · d deny", "approval", "small", "--soft"))
    if meter:
        rows.append((22, meter, "meter", "small clay", ""))
    y = bottom
    placed = []
    for h, text, name, cls, fill in rows:
        y -= h + 4
        placed.append(band(y, h, text, name, cls, fill))
    top = 186
    out.append(f'<rect class="box" x="{FX}" y="{top}" width="{FW}" height="{y - 4 - top}" rx="1"/>')
    out.append(f'<text class="mono small" x="{FX + 12}" y="{top + 22}">you  Tell a short story</text>')
    out.append(f'<text class="mono small" x="{FX + 12}" y="{top + 46}">golem {last}</text>')
    out.append(f'<text class="small faint" x="{FX + FW - 10}" y="{top + 22}" text-anchor="end">transcript</text>')
    out.append(f'<text class="small faint" x="{FX + FW - 10}" y="{top + 40}" text-anchor="end">gets what is left</text>')
    out.extend(placed)
    return "".join(out)


def bands() -> str:
    idle = frame("", False, "❯ Type a message.", "connected · a story · qwen3.5:4b · 2 messages", "Once, a golem of river clay…")
    busy = frame("writing · 412 chars · 3s", False, "…", "connected · a story · qwen3.5:4b · 3 messages", "It mixed ochre with water and…")
    wait = frame("waiting for your approval", True, "…", "connected · a story · qwen3.5:4b · 3 messages", "read_file notes.txt ?")
    labels = [
        ("idle", "nothing to show:", "no meter, no band"),
        ("a reply streams", "the meter asks for 1 row,", "the composer shrinks to …"),
        ("a call waits", "the approval band takes", "rows, the meter says so"),
    ]

    def label(i: int) -> str:
        title, a, b = labels[i]
        return (
            f'<rect x="20" y="180" width="190" height="80" fill="var(--bg)"/>'
            f'<text class="mono clay" x="30" y="200" font-size="14">{title}</text>'
            f'<text class="small faint" x="30" y="222">{a}</text>'
            f'<text class="small faint" x="30" y="240">{b}</text>'
        )

    side = (
        '<text class="small faint" x="676" y="200">24 × 80 terminal:</text>'
        '<text class="small faint" x="676" y="218">a frame 79 wide,</text>'
        '<text class="small faint" x="676" y="236">and 15 rows of chat</text>'
        '<text class="small faint" x="676" y="290">short window:</text>'
        '<text class="small faint" x="676" y="308">bands give rows back</text>'
        '<text class="small faint" x="676" y="326">until the chat has one</text>'
    )
    anim = [
        group(f'<rect x="{FX - 10}" y="120" width="{FW + 20}" height="360" fill="var(--bg)"/>{busy}{label(1)}', 0.34, 0.64),
        group(f'<rect x="{FX - 10}" y="120" width="{FW + 20}" height="360" fill="var(--bg)"/>{wait}{label(2)}', 0.67, 0.97),
    ]
    body = f"""{header("THE SCREEN, IN GOLEM", "bands", "a band with nothing to show takes no rows")}
{idle}{label(0)}{side}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        500,
        "golem's screen, top to bottom, in three moments. Idle: the header, the transcript, the composer, and the status line. While a reply streams, the meter takes one row, writing with the characters and seconds, and the composer shrinks to an ellipsis. While a tool call waits, the approval band takes rows above the composer and the meter says waiting for your approval. The transcript gets every row the others leave. A 24 by 80 terminal gives a frame 79 columns wide and 15 rows of chat.",
        body,
    )


out = sys.argv[1]
for name, svg in [("tui-fold", fold()), ("tui-layers", layers()), ("tui-keys", keys()), ("tui-bands", bands())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
