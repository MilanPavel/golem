"""Draws the figures of docs/architecture/tracing.md as animated SVGs.

- tracing-idea.svg: a trace in general. A run is cut into spans, and each span has its time,
  its exact input, and its exact output. The widest bar is the slow step.
- tracing-golem.svg: golem keeps events, checkpoint messages, and blobs. `trace.get` reads the
  events into a tree. `trace.span` joins all three for one span.

Run from the repo root: python3 scripts/figures/tracing.py docs/images
"""

import sys

from svg import arrow_right, card, facts, grow, header, mover, outline, shown

# --- A trace, in agents generally ---------------------------------------------------------

BX0, BX1 = 292, 592
ROWS = [
    # indent, label, mono, start, end, time, in, out
    (0, "Run: fix the bug", False, 0.0, 1.0, "14.2 s", "your question", "the answer"),
    (1, "Model call 1", False, 0.0, 0.10, "1.4 s", "question + tools", "asks for grep"),
    (2, "grep", True, 0.10, 0.12, "0.1 s", 'pattern "TODO"', "3 matches"),
    (1, "Model call 2", False, 0.12, 0.34, "3.1 s", "+ 3 matches", "asks for edit_file"),
    (2, "edit_file", True, 0.34, 0.37, "0.2 s", "the new text", "file written"),
    (1, "Model call 3", False, 0.37, 1.0, "8.9 s", "+ the diff, 31K tokens", "the answer"),
]
RY = [152 + i * 30 for i in range(len(ROWS))]


def idea() -> str:
    def x(f: float) -> float:
        return BX0 + f * (BX1 - BX0)

    rows = '<rect class="box" x="30" y="146" width="560" height="190" rx="2"/>'
    rows += '<text class="mono label" x="46" y="140">SPANS</text><text class="mono label" x="292" y="140">TIME</text>'
    for (indent, label, mono, a, b, _t, _i, _o), y in zip(ROWS, RY, strict=True):
        cls = "mono small" if mono else ""
        size = "" if mono else ' font-size="14"'
        rows += f'<text class="{cls}" x="{46 + indent * 16}" y="{y + 17}"{size}>{label}</text>'
        rows += f'<rect x="{x(a):g}" y="{y + 6}" width="{max(x(b) - x(a), 3):g}" height="14" rx="2" style="fill:var(--line)" opacity=".7"/>'
    detail = (
        '<rect class="box" x="612" y="146" width="238" height="190" rx="2"/>'
        '<text class="mono label" x="626" y="172">THIS SPAN TOOK IN</text>'
        '<text class="mono label" x="626" y="236">AND GAVE OUT</text>'
        '<text class="mono label" x="626" y="300">IT TOOK</text>'
    )
    step = 1 / 7.0
    anim = []
    for i, ((_n, label, _m, a, b, took, tin, tout), y) in enumerate(zip(ROWS, RY, strict=True)):
        s, e = 0.04 + i * step * 0.95, 0.04 + (i + 1) * step * 0.95
        anim.append(outline(34, y, 552, 26, s, e))
        anim.append(grow(BX0 + a * (BX1 - BX0), y + 6, max((b - a) * (BX1 - BX0), 3), 14, [(0, 0), (s, 0), (s + 0.05, 1), (1, 1)], cls="dot"))
        anim.append(shown(f'<text class="mono small" x="626" y="196">{tin}</text>', s, e))
        anim.append(shown(f'<text class="mono small" x="626" y="260">{tout}</text>', s, e))
        anim.append(shown(f'<text class="mono small clay" x="626" y="324">{took}</text>', s, e))
    # at the end the widest model call is marked: it is the slow one
    anim.append(outline(BX0 - 4, RY[5] + 2, BX1 - BX0 + 8, 22, 0.88, 0.98))
    anim.append(shown('<text class="mono small clay" x="300" y="' + str(RY[5] + 17) + '" text-anchor="start">the slowest step</text>', 0.88, 0.98))
    body = f"""{header("IN AGENTS GENERALLY", "1 tree", "a run, cut into spans")}
{rows}{detail}
{facts(["a span is one step: a start, an end, a status", "it keeps its exact input and output", "a tool sits under the model call that asked for it"], 40, 372)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        454,
        "A trace in general: a run is cut into spans. The run holds three model calls, and two tool calls sit under the model calls that asked for them. Each span has its time as a bar, what it took in, and what it gave out. The third model call has the widest bar, so it is the slow step.",
        body,
    )


# --- golem's two methods ------------------------------------------------------------------


def golem() -> str:
    sources = (
        '<rect class="box" x="30" y="150" width="250" height="70" rx="2"/>'
        '<text class="mono label" x="46" y="172">EVENTS</text>'
        '<text class="mono small" x="46" y="192">model.call.*, tool.*</text>'
        '<text class="mono small" x="46" y="210">tokens, timings, duration_ms</text>'
        '<rect class="box" x="30" y="234" width="250" height="56" rx="2"/>'
        '<text class="mono label" x="46" y="256">CHECKPOINT</text>'
        '<text class="small muted" x="46" y="276">the messages, each with an id</text>'
        '<rect class="box" x="30" y="304" width="250" height="56" rx="2"/>'
        '<text class="mono label" x="46" y="326">BLOBS</text>'
        '<text class="small muted" x="46" y="346">system prompt and tools, by sha256</text>'
    )
    joins = (
        '<rect class="box" x="344" y="150" width="190" height="52" rx="2"/>'
        '<text class="mono label" x="358" y="172">BUILD_TRACE</text>'
        '<text class="small muted" x="358" y="191">events into a tree</text>'
        '<rect class="box" x="344" y="248" width="190" height="82" rx="2"/>'
        '<text class="mono label" x="358" y="270">READ_SPAN</text>'
        '<text class="small muted" x="358" y="290">messages by id</text>'
        '<text class="small muted" x="358" y="308">prompt and tools by hash</text>'
        '<text class="small muted" x="358" y="326">context split, estimated</text>'
    )
    outs = (
        '<rect class="box" x="598" y="150" width="252" height="52" rx="2"/>'
        '<text class="mono label" x="612" y="172">TRACE.GET</text>'
        '<text class="small muted" x="612" y="191">the tree, summaries only</text>'
        '<rect class="box" x="598" y="248" width="252" height="82" rx="2"/>'
        '<text class="mono label" x="612" y="270">TRACE.SPAN</text>'
        '<text class="small muted" x="612" y="290">one span in full:</text>'
        '<text class="small muted" x="612" y="308">input, output, and what</text>'
        '<text class="small muted" x="612" y="326">filled the context</text>'
    )
    wires = (
        arrow_right(280, 342, 176)
        + arrow_right(534, 596, 176)
        + '<path class="wire" d="M310 176 V332 M280 262 H310 M280 332 H310"/>'
        + arrow_right(310, 342, 289)
        + arrow_right(534, 596, 289)
    )
    anim = [
        mover("M280 176 H344", 0.03, 0.10),
        outline(340, 146, 198, 60, 0.10, 0.20),
        mover("M534 176 H598", 0.20, 0.27),
        outline(594, 146, 260, 60, 0.27, 0.42),
        mover("M280 186 H310 V289 H344", 0.52, 0.60),
        mover("M280 262 H310 V289 H344", 0.52, 0.60),
        mover("M280 332 H310 V289 H344", 0.52, 0.60),
        outline(340, 244, 198, 90, 0.60, 0.72),
        mover("M534 289 H598", 0.72, 0.79),
        outline(594, 244, 260, 90, 0.79, 0.95),
    ]
    body = f"""{header("ONE TRACE IN GOLEM", "2 methods", "the tree is joined when you ask")}
<rect x="20" y="130" width="840" height="244" rx="3" fill="var(--soft)"/>
{sources}{joins}{outs}{wires}
{facts(["nothing is joined while a session runs; it only writes", "trace.get reads the events alone", "trace.span adds the messages and the stored request"], 40, 410)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        488,
        "golem's trace: while a session runs, golem writes events, checkpoint messages, and blobs. The method trace.get reads only the events, and build_trace turns them into a tree of summaries. The method trace.span reads the events, the checkpoint messages, and the blobs, and read_span returns one span in full with its context split.",
        body,
    )


out = sys.argv[1]
for name, svg in [("tracing-idea", idea()), ("tracing-golem", golem())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
