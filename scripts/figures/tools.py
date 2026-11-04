"""Draws the figures of docs/architecture/tools.md as animated SVGs.

- tools-call.svg: a tool call in general. The program offers tools, the model writes a call,
  the program runs it and sends back the result. The second call fails, and the error is the
  result.
- tools-node.svg: golem's `tools` node decides about every call of a reply, then runs them,
  and each result goes to the model, the screen, and sometimes an artifact or graph state.
- tools-artifact.svg: long output is stored whole, and the model reads its head and tail,
  then pages through the rest.
- tools-write.svg: a file change is planned, shown as a diff, planned again, and written only
  when the diff is the one you approved.

Run from the repo root: python3 scripts/figures/tools.py docs/images
"""

import sys

from svg import arrow_down, arrow_right, blink, card, header, mover, outline, shown


def facts(items: list[str], x: float, y: float, gap: float = 22) -> str:
    parts = []
    for i, fact in enumerate(items):
        fy = y + i * gap
        parts.append(f'<rect class="dot" x="{x}" y="{fy - 8}" width="6" height="6"/>')
        parts.append(f'<text x="{x + 16}" y="{fy}" font-size="14" class="muted">{fact}</text>')
    return "".join(parts)


def arrow_left(x1: float, x2: float, y: float, back: bool = False) -> str:
    cls = "wire back" if back else "wire"
    return f'<path class="{cls}" d="M{x1} {y} H{x2 + 1}"/><path class="head" d="M{x2 + 7} {y - 4} L{x2} {y} L{x2 + 7} {y + 4} Z"/>'


# --- A tool call, in agents generally -----------------------------------------------------


def call() -> str:
    tools = (
        '<rect class="box" x="30" y="150" width="260" height="160" rx="2"/>'
        '<text class="mono label" x="46" y="174">TOOLS OFFERED</text>'
        '<text class="mono" x="46" y="202" font-size="14">grep</text>'
        '<text x="46" y="220" font-size="13" class="muted">search the files</text>'
        '<text class="mono small faint" x="46" y="238">pattern: string</text>'
        '<text class="mono" x="46" y="266" font-size="14">todo_write</text>'
        '<text x="46" y="284" font-size="13" class="muted">keep a todo list</text>'
        '<text class="mono small faint" x="46" y="302">todos: one in_progress</text>'
    )
    model = (
        '<rect class="box" x="350" y="198" width="160" height="64" rx="2"/>'
        '<text x="430" y="235" text-anchor="middle" font-size="18">Model</text>'
    )
    program = (
        '<rect class="box" x="574" y="150" width="276" height="160" rx="2"/>'
        '<text class="mono label" x="590" y="174">THE PROGRAM</text>'
        '<text class="mono small faint" x="590" y="204">call</text>'
        '<text class="mono small faint" x="590" y="258">result</text>'
    )
    wires = (
        arrow_right(290, 347, 230)
        + '<text class="mono label" x="320" y="220" text-anchor="middle" font-size="11">LIST</text>'
        + arrow_right(510, 571, 214)
        + '<text class="mono label" x="542" y="204" text-anchor="middle" font-size="11">CALL</text>'
        + arrow_left(574, 513, 246, back=True)
        + '<text class="mono label" x="542" y="266" text-anchor="middle" font-size="11">RESULT</text>'
    )

    def cycle(o: float, row_y: float, text: str, result: str, error: bool) -> str:
        cls = "mono small clay" if error else "mono small"
        parts = [mover("M290 230 H348", o + 0.02, o + 0.08)]
        parts.append(outline(346, 194, 168, 72, o + 0.08, o + 0.16))
        parts.append(outline(38, row_y, 244, 58, o + 0.10, o + 0.30))
        parts.append(mover("M510 214 H572", o + 0.16, o + 0.22))
        parts.append(shown(f'<text class="mono" x="590" y="226" font-size="13">{text}</text>', o + 0.22, o + 0.46))
        parts.append(outline(570, 146, 284, 168, o + 0.22, o + 0.30))
        parts.append(shown(f'<text class="{cls}" x="590" y="280">{result}</text>', o + 0.30, o + 0.46))
        parts.append(mover("M574 246 H512", o + 0.30, o + 0.36))
        parts.append(outline(346, 194, 168, 72, o + 0.36, o + 0.44))
        return "".join(parts)

    anim = cycle(0.0, 184, 'grep(pattern="TODO")', "notes.txt:3: TODO: changelog", error=False)
    anim += cycle(0.5, 248, "todo_write(both in_progress)", "error: one in_progress at a time", error=True)
    body = f"""{header("IN AGENTS GENERALLY", "1 call", "a name and arguments, written as text")}
<rect x="20" y="130" width="840" height="196" rx="3" fill="var(--soft)"/>
{tools}{model}{program}{wires}
{facts(["the model only writes the call", "the program checks it, and runs it", "a failure is a result too"], 40, 362)}
<g class="anim">{anim}</g>"""
    return card(
        432,
        "A tool call: the program offers a list of tools, the model writes a call with a name and arguments, the program runs it and sends back the result. When a call fails, the error goes back as its result, and the model can try again.",
        body,
    )


# --- golem's tools node -------------------------------------------------------------------

OUT = [
    ("ToolMessage", "the model reads it"),
    ("tool.completed", "the screen sees it"),
    ("artifacts", "if over 20 000 chars"),
    ("todos", "graph state, if allowed"),
]
OUT_Y = [162, 216, 270, 324]


def node() -> str:
    decide = (
        '<rect class="box" x="44" y="168" width="232" height="128" rx="2"/>'
        '<text class="mono label" x="60" y="192">1 · DECIDE, EVERY CALL</text>'
        '<text x="60" y="222" font-size="14">is it a tool here?</text>'
        '<text x="60" y="246" font-size="14">preview a file change</text>'
        '<text x="60" y="270" font-size="14">rules: allow · ask · deny</text>'
    )
    run = (
        '<rect class="box" x="316" y="168" width="232" height="128" rx="2"/>'
        '<text class="mono label" x="332" y="192">2 · RUN, ONE BY ONE</text>'
        '<text x="332" y="222" font-size="14">check the arguments</text>'
        '<text x="332" y="246" font-size="14">run, stream its output</text>'
        '<text x="332" y="270" font-size="14">a result, or an error</text>'
    )
    rows = "".join(
        f'<rect class="box" x="632" y="{y - 22}" width="218" height="44" rx="2"/>'
        f'<text class="mono" x="646" y="{y - 3}" font-size="13">{name}</text>'
        f'<text class="small faint" x="646" y="{y + 14}">{how}</text>'
        for (name, how), y in zip(OUT, OUT_Y, strict=True)
    )
    stubs = "".join(
        f'<path class="wire" d="M600 {y} H626"/><path class="head" d="M622 {y - 4} L629 {y} L622 {y + 4} Z"/>'
        for y in OUT_Y
    )
    wires = (
        arrow_down(160, 124, 166)
        + '<text class="mono label" x="160" y="116" text-anchor="middle">A REPLY\'S TOOL CALLS</text>'
        + arrow_right(276, 313, 232)
        + f'<path class="wire" d="M548 232 H600 M600 {OUT_Y[0]} V{OUT_Y[-1]}"/>'
        + stubs
        + '<path class="wire back" d="M160 296 V340"/>'
        + '<text class="small muted" x="172" y="336">ask: the run pauses here for you (chapter 4)</text>'
    )

    def cycle(o: float, verdict: str, outs: list[int]) -> str:
        parts = [mover("M160 124 V166", o + 0.01, o + 0.05)]
        parts.append(outline(40, 164, 240, 136, o + 0.05, o + 0.14))
        parts.append(shown(f'<text class="mono small clay" x="172" y="152">{verdict}</text>', o + 0.05, o + 0.30))
        parts.append(mover("M276 232 H314", o + 0.14, o + 0.17))
        parts.append(outline(312, 164, 240, 136, o + 0.17, o + 0.24))
        for row in outs:
            parts.append(mover(f"M548 232 H600 V{OUT_Y[row]} H630", o + 0.24, o + 0.29))
            parts.append(outline(628, OUT_Y[row] - 26, 226, 52, o + 0.29, o + 0.32))
        return "".join(parts)

    anim = cycle(0.0, "grep → allow", [0, 1])
    anim += cycle(0.333, "shell → ask, you allow", [0, 1, 2])
    anim += cycle(0.666, "todo_write → allow", [0, 1, 3])
    body = f"""{header("ONE REPLY IN GOLEM", "2 passes", "decide about every call, then run them")}
<rect x="24" y="134" width="544" height="182" rx="3" fill="var(--soft)"/>
{decide}{run}{wires}{rows}
<g class="anim">{anim}</g>"""
    return card(
        372,
        "golem's tools node: for a reply's tool calls it first decides about every call (is the tool here, a preview of a file change, and the rules: allow, ask, or deny), and only then runs them one by one. Each result goes to the model as a ToolMessage and to the screen as tool.completed. Long output also goes to an artifact, and a todo list to graph state.",
        body,
    )


# --- Long output becomes an artifact ------------------------------------------------------

X0, X1 = 200, 840
SCALE = (X1 - X0) / 100_000


def at(chars: float) -> float:
    return X0 + chars * SCALE


def artifact() -> str:
    head, tail = at(12_000), at(96_000)
    limit = at(20_000)
    rows = f"""
<text class="mono label" x="40" y="166">OUTPUT</text>
<text class="small faint" x="40" y="184">100 000 chars</text>
<rect x="{X0}" y="150" width="{X1 - X0}" height="28" rx="2" style="fill:var(--line)" opacity=".55"/>
<path d="M{limit} 140 V188" stroke="var(--clay)" stroke-width="1.4" stroke-dasharray="3 3"/>
<text class="mono small clay" x="{limit + 6}" y="142">20 000</text>

<text class="mono label" x="40" y="238">THE MODEL READS</text>
<text class="small faint" x="40" y="256">in the checkpoint</text>
<rect x="{X0}" y="222" width="{head - X0}" height="28" rx="2" style="fill:var(--clay)"/>
<text class="mono small faint" x="{X0}" y="270">head 12 000</text>
<rect class="box" x="{head + 8}" y="222" width="{tail - head - 16}" height="28" rx="2" style="stroke:var(--line);stroke-dasharray:3 3"/>
<text class="mono small faint" x="{(head + tail) / 2}" y="241" text-anchor="middle">[84 000 characters cut … in artifact a_… · read_artifact]</text>
<rect x="{tail}" y="222" width="{X1 - tail}" height="28" rx="2" style="fill:var(--clay)"/>
<text class="mono small faint" x="{X1}" y="270" text-anchor="end">tail 4 000</text>

<text class="mono label" x="40" y="310">ARTIFACTS</text>
<text class="small faint" x="40" y="328">golem.db, all of it</text>
<rect x="{X0}" y="294" width="{X1 - X0}" height="28" rx="2" style="fill:var(--clay)" opacity=".45"/>

<text class="mono label" x="40" y="382">READ_ARTIFACT</text>
<text class="small faint" x="40" y="400">up to 20 000 a page</text>
<rect class="box" x="{X0}" y="366" width="{X1 - X0}" height="28" rx="2"/>
"""
    anim = [outline(X0 - 4, 146, X1 - X0 + 8, 36, 0.02, 0.14)]
    anim.append(mover(f"M{X0 + 40} 178 V222", 0.14, 0.22))
    anim.append(mover(f"M{X1 - 16} 178 V222", 0.14, 0.22))
    anim.append(outline(X0 - 4, 218, X1 - X0 + 8, 36, 0.22, 0.34))
    anim.append(mover(f"M{(X0 + X1) / 2} 178 V294", 0.30, 0.40))
    anim.append(outline(X0 - 4, 290, X1 - X0 + 8, 36, 0.40, 0.50))
    page_w = limit - X0
    for i, offset in enumerate((12_000, 32_000, 52_000, 72_000)):
        start = 0.50 + i * 0.11
        x = at(offset)
        w = min(page_w, X1 - x)
        anim.append(outline(x, 290, w, 36, start, start + 0.10))
        anim.append(mover(f"M{x + w / 2} 326 V380", start + 0.02, start + 0.07, size=7))
        anim.append(f'<rect x="{x}" y="366" width="{w}" height="28" rx="2" style="fill:var(--clay)" opacity="0">{blink(start + 0.07, start + 0.10)}</rect>')
        anim.append(shown(f'<text class="mono small clay" x="{x}" y="418">offset {offset:,}'.replace(",", " ") + "</text>", start + 0.05, start + 0.10))
    body = f"""{header("LONG TOOL OUTPUT", "20 000", "characters, then it is an artifact")}
{rows}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        440,
        "Long tool output: output over 20 000 characters is stored whole as an artifact in golem.db. The model reads its first 12 000 and last 4 000 characters, with a note in between that names the artifact, and pages through the rest with read_artifact, up to 20 000 characters at a time.",
        body,
    )


# --- A file change ------------------------------------------------------------------------

STAGES = [
    ("PLAN", "the new text,", "nothing written"),
    ("ASK", "approval.needed", "with the diff"),
    ("YOU", "allow", "this diff"),
    ("PLAN AGAIN", "when the call runs", "same diff?"),
]
SX = [30, 196, 362, 528]
SW = 150


def write() -> str:
    boxes = ""
    for (title, a, b), x in zip(STAGES, SX, strict=True):
        boxes += (
            f'<rect class="box" x="{x}" y="150" width="{SW}" height="92" rx="2"/>'
            f'<text class="mono label" x="{x + 14}" y="174">{title}</text>'
            f'<text x="{x + 14}" y="202" font-size="14">{a}</text>'
            f'<text x="{x + 14}" y="222" font-size="14" class="muted">{b}</text>'
        )
    for x in SX[:-1]:
        boxes += arrow_right(x + SW, x + SW + 13, 196)
    ends = (
        '<path class="wire" d="M678 196 H700 M700 172 V292"/>'
        '<path class="wire" d="M700 172 H714"/><path class="head" d="M708 168 L715 172 L708 176 Z"/>'
        '<path class="wire" d="M700 292 H714"/><path class="head" d="M708 288 L715 292 L708 296 Z"/>'
        '<rect class="box" x="718" y="146" width="132" height="52" rx="2"/>'
        '<text class="mono label" x="732" y="166">YES</text>'
        '<text x="732" y="188" font-size="14">write it</text>'
        '<rect class="box" x="718" y="266" width="132" height="52" rx="2"/>'
        '<text class="mono label" x="732" y="286">NO</text>'
        '<text x="732" y="308" font-size="14">tool.failed</text>'
    )
    diff = (
        '<rect x="196" y="262" width="316" height="58" rx="2" style="fill:var(--sunken)"/>'
        '<text class="mono small faint" x="210" y="284" style="white-space:pre">-     return a + b</text>'
        '<text class="mono small clay" x="210" y="306" style="white-space:pre">+     return int(a) + int(b)</text>'
        '<path class="wire back" d="M271 242 V262"/>'
    )
    note = (
        '<text class="small muted" x="30" y="352">The write is a temp file and a rename, in the same folder.</text>'
        '<text class="small muted" x="30" y="372">If the file changed while you looked, the diff differs, and nothing is written.</text>'
    )

    def cycle(o: float, ok: bool) -> str:
        parts = []
        for i, x in enumerate(SX):
            parts.append(outline(x - 4, 146, SW + 8, 100, o + 0.02 + i * 0.07, o + 0.09 + i * 0.07))
            if i < len(SX) - 1:
                parts.append(mover(f"M{x + SW} 196 H{x + SW + 14}", o + 0.08 + i * 0.07, o + 0.10 + i * 0.07, size=7))
        parts.append(outline(192, 258, 324, 66, o + 0.09, o + 0.30))
        if not ok:
            parts.append(shown('<text class="mono small clay" x="603" y="266" text-anchor="middle">the file changed</text>', o + 0.20, o + 0.44))
        y = 172 if ok else 292
        top = 142 if ok else 262
        parts.append(mover(f"M678 196 H700 V{y} H716", o + 0.31, o + 0.35))
        parts.append(outline(714, top, 140, 60, o + 0.35, o + 0.46))
        return "".join(parts)

    body = f"""{header("ONE FILE CHANGE", "1 diff", "you approve the diff, not the call")}
{boxes}{ends}{diff}{note}
<g class="anim">{cycle(0.0, True)}{cycle(0.5, False)}</g>"""
    return card(
        396,
        "A file change in golem: the tool plans the new text without writing anything, the approval shows its diff, you allow that diff, and when the call runs it plans again. Only when the new plan makes the same diff is the file written. If the file changed in the meantime, the call fails and nothing is written.",
        body,
    )


out = sys.argv[1]
for name, svg in [
    ("tools-call", call()),
    ("tools-node", node()),
    ("tools-artifact", artifact()),
    ("tools-write", write()),
]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
