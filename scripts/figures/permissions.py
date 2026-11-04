"""Draws the figures of docs/architecture/permissions.md as animated SVGs.

- permissions-check.svg: three calls meet one list of rules. Each goes down the list until a
  rule matches, and that rule decides: allow, ask, or deny.
- permissions-order.svg: where golem's rules come from, in the order they are checked, and the
  session's allowances before the question.
- permissions-pause.svg: a call that asks pauses the run, which waits with no task, and resumes
  from the top of the tools node when you answer.

Run from the repo root: python3 scripts/figures/permissions.py docs/images
"""

import sys

from svg import arrow_down, arrow_right, card, header, mover, outline, shown

# --- First match wins, in agents generally ------------------------------------------------

RULES = [
    ("deny", "read_file", "path **/.env"),
    ("allow", "shell", "match pytest*"),
    ("allow", "any read-only tool", ""),
    ("ask", "everything else", ""),
]
RULE_Y = [176, 222, 268, 314]
ENDS = [("ALLOW", "it runs"), ("ASK", "a person decides"), ("DENY", "the model reads why")]
END_Y = [184, 252, 320]


def check() -> str:
    rules = '<text class="mono label" x="300" y="150">RULES, IN ORDER</text>'
    for i, ((action, tool, extra), y) in enumerate(zip(RULES, RULE_Y, strict=True)):
        rules += (
            f'<rect class="box" x="300" y="{y - 18}" width="300" height="36" rx="2"/>'
            f'<text class="mono small faint" x="312" y="{y + 4}">{i + 1}</text>'
            f'<text class="mono" x="332" y="{y + 5}" font-size="13" style="fill:var(--clay-ink)">{action}</text>'
            f'<text class="mono" x="384" y="{y + 5}" font-size="13">{tool}</text>'
            f'<text class="mono small faint" x="588" y="{y + 4}" text-anchor="end">{extra}</text>'
        )
    ends = ""
    for (title, sub), y in zip(ENDS, END_Y, strict=True):
        ends += (
            f'<rect class="box" x="680" y="{y - 24}" width="170" height="48" rx="2"/>'
            f'<text class="mono label" x="694" y="{y - 4}">{title}</text>'
            f'<text x="694" y="{y + 14}" font-size="13" class="muted">{sub}</text>'
        )
    calls = '<text class="mono label" x="30" y="150">A TOOL CALL</text>'
    calls += '<rect class="box" x="30" y="200" width="220" height="44" rx="2"/>'
    calls += arrow_right(250, 297, 222)
    calls += "".join(f'<path class="wire" d="M600 {y} H640"/>' for y in RULE_Y)
    calls += '<path class="wire" d="M640 176 V320"/>'
    for y in END_Y:
        calls += f'<path class="wire" d="M640 {y} H674"/><path class="head" d="M670 {y - 4} L677 {y} L670 {y + 4} Z"/>'

    def cycle(o: float, text: str, row: int, end: int) -> str:
        parts = [shown(f'<text class="mono" x="44" y="227" font-size="13">{text}</text>', o + 0.01, o + 0.31)]
        step = 0.05
        for r in range(row + 1):
            parts.append(outline(296, RULE_Y[r] - 22, 308, 44, o + 0.04 + r * step, o + 0.04 + (r + 1) * step - 0.005))
        hit = o + 0.04 + (row + 1) * step
        parts.append(outline(296, RULE_Y[row] - 22, 308, 44, hit - 0.005, o + 0.31))
        parts.append(mover(f"M600 {RULE_Y[row]} H640 V{END_Y[end]} H676", hit, hit + 0.05))
        parts.append(outline(676, END_Y[end] - 28, 178, 56, hit + 0.05, o + 0.31))
        return "".join(parts)

    anim = cycle(0.0, "read_file .env", 0, 2)
    anim += cycle(0.333, "shell pytest -q", 1, 0)
    anim += cycle(0.666, "shell rm -rf build", 3, 1)
    body = f"""{header("IN AGENTS GENERALLY", "first match", "the first rule that fits decides")}
{rules}{ends}{calls}
<text class="small muted" x="30" y="370">A rule names a tool, and can narrow it to a subject or a path.</text>
<g class="anim">{anim}</g>"""
    return card(
        392,
        "Permission rules: each tool call goes down one list of rules, in order, and the first rule that fits decides. read_file .env meets a deny rule first. shell pytest -q is allowed by the second rule. shell rm -rf build fits only the last rule, so a person is asked.",
        body,
    )


# --- Where golem's rules come from --------------------------------------------------------

SOURCES = [
    ("1", "the project", ".golem/policy.toml", "allow counts only if trusted"),
    ("2", "you", "~/.golem/config.toml", "every rule counts"),
    ("3", "built-in defaults", "", "read-only and internal: allow · rest: ask"),
]
SRC_Y = [176, 238, 300]


def order() -> str:
    rows = ""
    for (n, who, where, note), y in zip(SOURCES, SRC_Y, strict=True):
        rows += (
            f'<rect class="box" x="210" y="{y - 24}" width="360" height="48" rx="2"/>'
            f'<text class="mono small faint" x="224" y="{y + 4}">{n}</text>'
            f'<text x="244" y="{y - 3}" font-size="15">{who}</text>'
            f'<text class="mono small faint" x="556" y="{y - 3}" text-anchor="end">{where}</text>'
            f'<text x="244" y="{y + 15}" font-size="13" class="muted">{note}</text>'
        )
    for a, b in zip(SRC_Y, SRC_Y[1:], strict=False):
        rows += arrow_down(390, a + 24, b - 24)
    left = (
        '<text class="mono label" x="30" y="150">ONE CALL</text>'
        '<rect class="box" x="30" y="154" width="150" height="44" rx="2"/>'
        + arrow_right(180, 207, 176)
    )
    right = (
        '<path class="wire" d="M570 176 H612 M612 176 V300 M570 238 H612 M570 300 H612"/>'
        '<path class="wire" d="M612 238 H646"/><path class="head" d="M642 234 L649 238 L642 242 Z"/>'
        '<rect class="box" x="650" y="186" width="200" height="104" rx="2"/>'
        '<text class="mono label" x="664" y="208">FIRST MATCH</text>'
        '<text x="664" y="232" font-size="14">allow: it runs</text>'
        '<text x="664" y="254" font-size="14">deny: tool.failed</text>'
        '<text x="664" y="276" font-size="14">ask: next, below</text>'
        + arrow_down(750, 290, 336)
        + '<rect class="box" x="580" y="338" width="270" height="48" rx="2"/>'
        '<text x="594" y="358" font-size="14">allowed for this session?</text>'
        '<text x="594" y="376" font-size="13" class="muted">yes: it runs · no: approval.needed</text>'
    )

    def cycle(o: float, text: str, row: int, verdict: str, session: bool) -> str:
        parts = [shown(f'<text class="mono" x="44" y="181" font-size="13">{text}</text>', o + 0.01, o + 0.32)]
        for r in range(row + 1):
            parts.append(outline(206, SRC_Y[r] - 28, 368, 56, o + 0.04 + r * 0.05, o + 0.085 + r * 0.05))
        hit = o + 0.04 + (row + 1) * 0.05
        parts.append(outline(206, SRC_Y[row] - 28, 368, 56, hit - 0.005, o + 0.32))
        parts.append(mover(f"M570 {SRC_Y[row]} H612 V238 H648", hit, hit + 0.04))
        parts.append(outline(646, 182, 208, 112, hit + 0.04, o + 0.32))
        parts.append(shown(f'<text class="mono small clay" x="664" y="176">{verdict}</text>', hit + 0.04, o + 0.32))
        if session:
            parts.append(mover("M750 290 V336", hit + 0.08, hit + 0.11))
            parts.append(outline(576, 334, 278, 56, hit + 0.11, o + 0.32))
        return "".join(parts)

    anim = cycle(0.0, "read_file .env", 0, "deny, project rule 1", False)
    anim += cycle(0.333, "grep TODO", 2, "allow, read-only", False)
    anim += cycle(0.666, "shell ls", 2, "ask, built-in default", True)
    body = f"""{header("ONE CALL IN GOLEM", "3 sources", "the project, you, then the defaults")}
{left}{rows}{right}
<g class="anim">{anim}</g>"""
    return card(
        412,
        "Where golem's rules come from, in the order they are checked: the project's .golem/policy.toml, whose allow rules count only in a trusted folder, then your ~/.golem/config.toml, then the built-in defaults. The first rule that matches decides. A call that asks runs if this session already allowed it, and otherwise waits for approval.",
        body,
    )


# --- An approval pauses the run -----------------------------------------------------------

STEPS = [
    ("1 · ASK", "interrupt()", "at the first call", "that asks"),
    ("2 · WAIT", "run: waiting", "no task in memory", "survives a restart"),
    ("3 · ANSWER", "a · s · w · e · d", "approval.respond", ""),
    ("4 · RESUME", "the node again,", "from its first line", "old answers return"),
    ("5 · RUN", "only now, the", "allowed calls run", "one by one"),
]
PX = [30, 196, 362, 528, 694]
PW = 156


def pause() -> str:
    boxes = ""
    for (title, a, b, c), x in zip(STEPS, PX, strict=True):
        boxes += (
            f'<rect class="box" x="{x}" y="150" width="{PW}" height="110" rx="2"/>'
            f'<text class="mono label" x="{x + 14}" y="174">{title}</text>'
            f'<text x="{x + 14}" y="202" font-size="14">{a}</text>'
            f'<text x="{x + 14}" y="222" font-size="13" class="muted">{b}</text>'
            f'<text x="{x + 14}" y="240" font-size="13" class="muted">{c}</text>'
        )
    for x in PX[:-1]:
        boxes += arrow_right(x + PW, x + PW + 9, 205)
    lanes = (
        '<text class="mono label" x="30" y="300">ON THE WIRE</text>'
        '<text class="mono small" x="30" y="324">tool.requested · approval.needed</text>'
        '<text class="mono small" x="362" y="324">approval.resolved</text>'
        '<text class="mono small" x="528" y="324">tool.started · tool.completed</text>'
        '<text class="small muted" x="30" y="364">Nothing runs, and no event is sent, before the last answer. So a resume repeats nothing.</text>'
    )
    anim = []
    for i, x in enumerate(PX):
        start = 0.03 + i * 0.17
        end = start + (0.30 if i == 1 else 0.12)
        anim.append(outline(x - 4, 146, PW + 8, 118, start, min(end, 0.97)))
        if i < len(PX) - 1:
            anim.append(mover(f"M{x + PW} 205 H{x + PW + 10}", start + 0.14, start + 0.17, size=7))
    anim.append(shown('<text class="mono small clay" x="274" y="282" text-anchor="middle">the daemon restarts</text>', 0.26, 0.34))
    body = f"""{header("ONE APPROVAL IN GOLEM", "0 tasks", "while the run waits for you")}
{boxes}{lanes}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        388,
        "An approval in golem: the tools node calls interrupt() at the first call that asks, and the run waits with no task in memory, so it survives a daemon restart. Your answer is approval.respond. The node then runs again from its first line, earlier answers come back, and only then do the allowed calls run.",
        body,
    )


out = sys.argv[1]
for name, svg in [
    ("permissions-check", check()),
    ("permissions-order", order()),
    ("permissions-pause", pause()),
]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
