"""Draws the two figures of docs/architecture/agent-loop.md as animated SVGs: the loop in general, and golem's graph.

One clay pulse travels: the request comes in, the model thinks, asks for a tool, the result
comes back, twice, and then the answer goes out. Colours are golem's tokens (slip, and kiln
under prefers-color-scheme: dark). With prefers-reduced-motion the pulse is hidden and the
figure is still.
"""

import sys

DUR = "10s"

# Path of the pulse, along the edges of the boxes so it never covers a label, and where it is
# at each key time (fractions of the path's length, 1176 in all). It rests on the model's right
# edge while the model thinks, and walks down the tool row's edge while a tool runs.
KEY_TIMES = "0;0.07;0.13;0.25;0.31;0.42;0.48;0.60;0.66;0.77;0.83;0.92;1"
KEY_POINTS = "0;0.1616;0.1616;0.3129;0.3367;0.4881;0.5119;0.6633;0.6871;0.8384;0.8384;1;1"
PATH = "M250 128 V200 H350 V218 H528 V246 H350 V218 H528 V246 H350 V264 H250 V336"


def window(start: float, end: float, fade: float = 0.015) -> tuple[str, str]:
    """keyTimes and values for an opacity that is 1 between start and end, else 0."""
    times = [0, max(start - fade, 0.0001), start, end, min(end + fade, 0.9999), 1]
    return ";".join(f"{t:.4f}" for t in times), "0;0;1;1;0;0"


def blink(start: float, end: float, attr: str = "opacity") -> str:
    times, values = window(start, end)
    return (
        f'<animate attributeName="{attr}" dur="{DUR}" repeatCount="indefinite" '
        f'keyTimes="{times}" values="{values}"/>'
    )


def figure(v: dict[str, str]) -> str:
    tools = ""
    for i in range(4):
        x = 530 + i * 44
        tools += f'<rect class="tool" x="{x}" y="208" width="34" height="34" rx="2"/>'
    # The tool each trip lights up: the first, then the third.
    lit = ""
    for i, (a, b) in ((0, (0.25, 0.31)), (2, (0.60, 0.66))):
        x = 530 + i * 44 - 4
        lit += (
            f'<rect class="lit" x="{x}" y="204" width="42" height="42" rx="4" opacity="0">'
            f"{blink(a, b)}</rect>"
        )
    # The model "thinks" each time the pulse rests on it.
    think = ""
    for a, b in ((0.07, 0.13), (0.42, 0.48), (0.77, 0.83)):
        think += (
            f'<rect class="think" x="146" y="196" width="208" height="72" rx="5" opacity="0">'
            f"{blink(a, b)}</rect>"
        )
    calls = ""
    for n, (a, b) in enumerate(((0.07, 0.25), (0.42, 0.60), (0.77, 0.92)), start=1):
        calls += (
            f'<text class="mono small clay" x="250" y="254" text-anchor="middle" opacity="0">'
            f"{v['call']} {n} of 3{blink(a, b)}</text>"
        )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 372" role="img" aria-label="{v['aria']}">
<style>
  :root {{ --bg:#F3F2EF; --surface:#FBFAF8; --ink:#1D1A17; --muted:#57524C; --faint:#6C665F;
          --line:#B9B3AA; --clay:#C4783A; --clay-ink:#94501E; --soft:#F1E2D4; --tool:#B8754F; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#15120F; --surface:#1D1915; --ink:#EEE7DF; --muted:#B5ACA2; --faint:#8F877E;
            --line:#5A5148; --clay:#D08549; --clay-ink:#E6A06A; --soft:#2E2118; --tool:#B8754F; }}
  }}
  @media (prefers-reduced-motion: reduce) {{ .pulse, .anim {{ display:none }} }}
  text {{ font-family: Geist, Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; fill: var(--ink); }}
  .mono {{ font-family: "Geist Mono", "SF Mono", Menlo, Consolas, monospace; letter-spacing: .06em; }}
  .label {{ font-size: 13px; fill: var(--muted); }}
  .small {{ font-size: 12px; }}
  .clay {{ fill: var(--clay-ink); }}
  .wire {{ stroke: var(--line); stroke-width: 1.2; fill: none; }}
  .head {{ fill: var(--line); }}
  .tool {{ fill: var(--tool); }}
  .lit {{ fill: none; stroke: var(--clay); stroke-width: 2; }}
  .think {{ fill: none; stroke: var(--clay); stroke-width: 1.5; }}
  .box {{ fill: var(--surface); }}
</style>
<rect width="880" height="372" rx="12" fill="var(--bg)"/>

<text class="mono label" x="32" y="44">{v['eyebrow']}</text>
<text class="mono" x="848" y="62" text-anchor="end" font-size="40" style="fill:var(--clay-ink)">{v['big']}</text>
<text x="848" y="90" text-anchor="end" font-size="16" style="fill:var(--muted)">{v['sub']}</text>

<text class="mono label" x="250" y="120" text-anchor="middle">{v['request']}</text>
<path class="wire" d="M250 126 V196"/><path class="head" d="M246 190 L250 197 L254 190 Z"/>

<rect x="120" y="150" width="640" height="150" rx="3" fill="var(--soft)"/>
<text x="140" y="180" font-size="17">{v['panel']}</text>

<rect class="box" x="150" y="200" width="200" height="64" rx="2"/>
<text x="250" y="236" text-anchor="middle" font-size="18" class="{v['model_class']}">{v['model']}</text>
<g class="anim">{calls}</g>

<path class="wire" d="M350 218 H522"/><path class="head" d="M516 214 L523 218 L516 222 Z"/>
<text class="mono label" x="436" y="208" text-anchor="middle">{v['calls']}</text>
<path class="wire" d="M528 246 H356"/><path class="head" d="M362 242 L355 246 L362 250 Z"/>
<text class="mono label" x="436" y="268" text-anchor="middle">{v['results']}</text>

<text x="618" y="196" text-anchor="middle" font-size="15">{v['tools']}</text>
{tools}
<rect x="706" y="208" width="34" height="34" rx="2" fill="none" stroke="var(--clay)" stroke-dasharray="4 3" stroke-width="1.2"/>
<text class="mono small" x="618" y="284" text-anchor="middle" style="fill:var(--faint)">{v['toolnames']}</text>

<path class="wire" d="M250 264 V328"/><path class="head" d="M246 322 L250 329 L254 322 Z"/>
<text class="mono label" x="250" y="352" text-anchor="middle">{v['answer']}</text>

<g class="anim">{think}{lit}</g>

<g class="pulse">
  <rect x="-5" y="-5" width="10" height="10" fill="var(--clay)">
    <animateMotion dur="{DUR}" repeatCount="indefinite" calcMode="linear" path="{PATH}"
      keyTimes="{KEY_TIMES}" keyPoints="{KEY_POINTS}"/>
    <animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite"
      keyTimes="0;0.02;0.92;0.96;1" values="0;1;1;0;0"/>
  </rect>
</g>
</svg>
"""


GENERAL = {
    "aria": "The agent loop: a request goes to the model, the model asks for a tool, the result comes back, twice, and then the answer goes out.",
    "eyebrow": "ONE MESSAGE",
    "big": "1 loop",
    "sub": "one model, a few tools, until it answers",
    "request": "REQUEST",
    "panel": "The agent loop",
    "model": "Model",
    "model_class": "",
    "call": "call",
    "calls": "TOOL CALLS",
    "results": "RESULTS",
    "tools": "Tools",
    "toolnames": "read · run · edit · search",
    "answer": "ANSWER",
}

GOLEM = {
    "aria": "golem's graph: message.send starts a run, call_model asks for tools, the tools node returns their results, twice, and run.completed ends it.",
    "eyebrow": "ONE MESSAGE",
    "big": "2 nodes",
    "sub": "call_model and tools, inside the daemon",
    "request": "MESSAGE.SEND",
    "panel": "One run, in the daemon",
    "model": "call_model",
    "model_class": "mono",
    "call": "call",
    "calls": "TOOL.REQUESTED",
    "results": "TOOL.COMPLETED",
    "tools": "tools",
    "toolnames": "read_file · shell · edit_file · grep",
    "answer": "RUN.COMPLETED",
}

# Run from the repo root: python3 scripts/figures/agent_loop.py docs/images
out = sys.argv[1]
open(f"{out}/agent-loop.svg", "w").write(figure(GENERAL))
open(f"{out}/agent-loop-golem.svg", "w").write(figure(GOLEM))
print("ok")
