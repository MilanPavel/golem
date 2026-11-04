"""Draws the figures of docs/architecture/mcp.md as animated SVGs.

- mcp-many.svg: why a standard. Without one, every agent writes glue for every service: 3 × 4
  = 12 integrations. With MCP, each agent has one client and each service one server: 3 + 4.
- mcp-lifecycle.svg: one connection between a client and a server, in the order it talks:
  the handshake, the tool list, and a call, with the model on the far side of the agent.
- mcp-golem.svg: one MCP call in golem, from config.toml to the server and back, asked first and
  marked as data.

Run from the repo root: python3 scripts/figures/mcp.py docs/images
"""

import sys

from svg import arrow_down, arrow_right, blink, card, header, mover, outline, shown

# --- Many to many, in agents generally ----------------------------------------------------

AGENTS = ["a coding agent", "a chat app", "an editor"]
SERVICES = ["GitHub", "a database", "a browser", "your files"]
AY = [190, 260, 330]
SY = [172, 226, 280, 334]


def many() -> str:
    parts = [
        '<text class="mono label" x="30" y="146">WITHOUT A STANDARD</text>',
        '<text class="mono label" x="470" y="146">WITH MCP</text>',
        '<path class="edge" d="M440 150 V390"/>',
    ]
    anim = []
    # Left: every agent to every service.
    for i, (name, y) in enumerate(zip(AGENTS, AY, strict=True)):
        parts.append(f'<rect class="box" x="30" y="{y - 18}" width="124" height="36" rx="2"/>')
        parts.append(f'<text x="42" y="{y + 5}" font-size="13">{name}</text>')
        for j, sy in enumerate(SY):
            parts.append(f'<path class="wire" d="M154 {y} L290 {sy}"/>')
            o = 0.02 + (i * 4 + j) * 0.028
            anim.append(
                f'<path d="M154 {y} L290 {sy}" style="stroke:var(--clay);stroke-width:2;fill:none" opacity="0">'
                f'{blink(o, 0.46)}</path>'
            )
    for name, y in zip(SERVICES, SY, strict=True):
        parts.append(f'<rect class="box" x="290" y="{y - 18}" width="120" height="36" rx="2"/>')
        parts.append(f'<text x="302" y="{y + 5}" font-size="13">{name}</text>')
    parts.append('<text class="mono small clay" x="30" y="392">12 pieces of glue</text>')
    # Right: one client per agent, one server per service, one protocol between.
    for name, y in zip(AGENTS, AY, strict=True):
        parts.append(f'<rect class="box" x="470" y="{y - 18}" width="124" height="36" rx="2"/>')
        parts.append(f'<text x="482" y="{y + 1}" font-size="13">{name}</text>')
        parts.append(f'<text class="mono small faint" x="482" y="{y + 14}">client</text>')
        parts.append(f'<path class="wire" d="M594 {y} H636"/>')
    parts.append('<rect x="636" y="150" width="26" height="206" rx="3" fill="var(--soft)" stroke="var(--clay)"/>')
    parts.append('<text class="mono small clay" x="649" y="258" text-anchor="middle" transform="rotate(-90 649 253)">MCP</text>')
    for name, y in zip(SERVICES, SY, strict=True):
        parts.append(f'<path class="wire" d="M662 {y} H714"/>')
        parts.append(f'<rect class="box" x="714" y="{y - 18}" width="136" height="36" rx="2"/>')
        parts.append(f'<text x="726" y="{y + 1}" font-size="13">{name}</text>')
        parts.append(f'<text class="mono small faint" x="726" y="{y + 14}">server</text>')
    parts.append('<text class="mono small clay" x="470" y="392">3 clients + 4 servers</text>')
    for k, (a, s) in enumerate([(0, 0), (1, 2), (2, 3), (0, 1)]):
        o = 0.52 + k * 0.11
        anim.append(mover(f"M594 {AY[a]} H649 V{SY[s]} H712", o, o + 0.08))
        anim.append(outline(710, SY[s] - 22, 144, 44, o + 0.08, o + 0.11))
    body = f"""{header("IN AGENTS GENERALLY", "12 → 7", "integrations, for 3 agents and 4 services")}
{"".join(parts)}
<text class="small muted" x="30" y="432">A service writes its server once, and every agent with a client can use it.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        458,
        "Why a standard. Without one, each of three agents writes its own glue for each of four services: twelve integrations. With MCP, each agent has one client and each service one server, and they all speak the same protocol: seven pieces, and any client works with any server.",
        body,
    )


# --- One connection, in agents generally ---------------------------------------------------

M, A, S = 100, 390, 680
LANES = [(M, "THE MODEL"), (A, "THE AGENT"), (S, "A SERVER")]
MESSAGES = [
    # from, to, label, detail
    (A, S, "initialize", "my protocol version, and what I can do"),
    (S, A, "result", "the same version, and: I have tools"),
    (A, S, "notifications/initialized", "a notification: no answer"),
    (A, S, "tools/list", "what can you do?"),
    (S, A, "result", "list_issues, create_issue, with schemas"),
    (A, M, "the tool list", "with the agent's own tools"),
    (M, A, "call list_issues", '{"state": "open"}'),
    (A, S, "tools/call", 'list_issues {"state": "open"}'),
    (S, A, "result", "content: #41 …, #42 …"),
    (A, M, "the tool result", "the model reads it next"),
]
PHASES = [(0, 2, "1 · HANDSHAKE"), (3, 5, "2 · DISCOVER"), (6, 9, "3 · CALL")]
MY0 = 176
MSTEP = 40


def lifecycle() -> str:
    bottom = MY0 + MSTEP * len(MESSAGES) + 6
    parts = []
    for x, name in LANES:
        parts.append(f'<rect class="box" x="{x - 74}" y="128" width="148" height="30" rx="2"/>')
        parts.append(f'<text class="mono label" x="{x}" y="148" text-anchor="middle">{name}</text>')
        parts.append(f'<path class="edge" d="M{x} 158 V{bottom}"/>')
    parts.append(f'<text class="small faint" x="{A - 8}" y="176" text-anchor="end">with its MCP client</text>')
    for first, last, name in PHASES:
        y1 = MY0 + 8 + first * MSTEP
        y2 = MY0 + 30 + last * MSTEP
        parts.append(f'<path class="wire" d="M744 {y1} H750 V{y2} H744"/>')
        parts.append(f'<text class="mono small faint" x="760" y="{(y1 + y2) / 2 + 4}">{name}</text>')
    anim = []
    for i, (a, b, label, detail) in enumerate(MESSAGES):
        y = MY0 + 18 + i * MSTEP
        mid = (a + b) / 2
        back = b < a
        tip = b + (7 if back else -7)
        parts.append(
            f'<path class="wire{" back" if back else ""}" d="M{a} {y} H{tip}"/>'
            f'<path class="head" d="M{tip} {y - 4} L{b} {y} L{tip} {y + 4} Z"/>'
        )
        protocol = M not in (a, b)
        cls = "mono small" if protocol else "small"
        parts.append(f'<text class="{cls}" x="{mid}" y="{y - 6}" text-anchor="middle">{label}</text>')
        parts.append(f'<text class="small faint" x="{mid}" y="{y + 15}" text-anchor="middle">{detail}</text>')
        o = 0.03 + i * 0.09
        anim.append(mover(f"M{a} {y} H{b}", o, o + 0.06, size=8))
        anim.append(shown(f'<text class="{cls} clay" x="{mid}" y="{y - 6}" text-anchor="middle">{label}</text>', o, o + 0.09))
    body = f"""{header("IN AGENTS GENERALLY", "JSON-RPC", "a few messages, the same for any server")}
{"".join(parts)}
<text class="small muted" x="30" y="{bottom + 30}">The agent runs the conversation, and the model never talks to the server. To the model, it is one more tool.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        bottom + 56,
        "One MCP connection, in three parts. The handshake: the agent's client sends initialize with its protocol version and capabilities, the server answers with its own, and the client sends notifications/initialized. Discovery: tools/list returns the server's tools with their schemas, and the agent offers them to the model with its own. A call: when the model calls list_issues, the client sends tools/call, and the result goes back to the model. The model never talks to the server.",
        body,
    )


# --- One MCP call in golem ----------------------------------------------------------------


def box(x: float, y: float, w: float, h: float, title: str, sub: str, mono: bool = True) -> str:
    cls = "mono" if mono else ""
    return (
        f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>'
        f'<text class="{cls}" x="{x + 14}" y="{y + h / 2 - 3}" font-size="13">{title}</text>'
        f'<text class="small faint" x="{x + 14}" y="{y + h / 2 + 14}">{sub}</text>'
    )


def golem() -> str:
    parts = [
        box(30, 150, 190, 56, "[mcp.tracker]", "in ~/.golem/config.toml"),
        arrow_right(220, 257, 178),
        box(260, 150, 230, 56, "McpSupervisor", "starts it, pings it every 30 s"),
        '<path class="wire" d="M490 178 H687"/><path class="head" d="M680 174 L687 178 L680 182 Z"/>',
        '<text class="mono small" x="588" y="170" text-anchor="middle">initialize · tools/list</text>',
        '<rect class="box" x="690" y="150" width="160" height="244" rx="2"/>',
        '<text class="mono" x="704" y="176" font-size="13">tracker</text>',
        '<text class="small faint" x="704" y="194">a child process, stdio</text>',
        '<text class="small faint" x="704" y="212">list_issues, create_issue</text>',
        arrow_down(375, 206, 244),
        box(260, 246, 230, 52, "ToolRegistry.scoped", "this session's tools"),
        '<path class="wire" d="M260 272 H125 V336"/><path class="head" d="M121 329 L125 336 L129 329 Z"/>',
        box(30, 338, 190, 56, "the model", "mcp__tracker__list_issues"),
        arrow_right(220, 257, 366),
        box(260, 338, 230, 56, "tools node", "built-in default: ask"),
        '<path class="wire" d="M490 366 H687"/><path class="head" d="M680 362 L687 366 L680 370 Z"/>',
        '<text class="mono small" x="588" y="358" text-anchor="middle">tools/call</text>',
        '<path class="wire back" d="M770 394 V430 H125 V401"/><path class="head" d="M121 408 L125 401 L129 408 Z"/>',
        '<text class="small faint" x="448" y="424" text-anchor="middle">the output, inside &lt;mcp_output&gt;, marked as data</text>',
    ]
    anim = [
        outline(26, 146, 198, 64, 0.02, 0.10),
        mover("M220 178 H258", 0.07, 0.10),
        outline(256, 146, 238, 64, 0.10, 0.18),
        mover("M490 178 H688", 0.14, 0.20),
        outline(686, 146, 168, 252, 0.20, 0.27),
        mover("M375 206 V244", 0.27, 0.30),
        outline(256, 242, 238, 60, 0.30, 0.37),
        mover("M260 272 H125 V336", 0.34, 0.40),
        outline(26, 334, 198, 64, 0.40, 0.48),
        mover("M220 366 H258", 0.46, 0.49),
        outline(256, 334, 238, 64, 0.49, 0.66),
        shown('<text class="mono small clay" x="375" y="326" text-anchor="middle">approval.needed → you allow</text>', 0.52, 0.66),
        mover("M490 366 H688", 0.66, 0.72),
        outline(686, 146, 168, 252, 0.72, 0.78),
        mover("M770 394 V430 H125 V401", 0.78, 0.90),
        outline(26, 334, 198, 64, 0.90, 0.98),
    ]
    body = f"""{header("ONE CALL IN GOLEM", "asks first", "every MCP tool, every call")}
{"".join(parts)}
<text class="small muted" x="30" y="466">Real, from one run with qwen3-coder:30b: seq 6 asks, seq 8 allows, seq 10 is the result.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        492,
        "One MCP call in golem. The supervisor starts the tracker server from config.toml, and initializes and lists it. The session's scoped registry gives the model mcp__tracker__list_issues. When the model calls it, the tools node asks, because the built-in default for an MCP tool is ask. After you allow it, tools/call goes to the server, and the output comes back inside mcp_output, marked as data.",
        body,
    )


out = sys.argv[1]
for name, svg in [("mcp-many", many()), ("mcp-lifecycle", lifecycle()), ("mcp-golem", golem())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
