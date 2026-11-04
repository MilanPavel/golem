"""Draws the figures of docs/architecture/models.md as animated SVGs.

- models-where.svg: where a model runs, hosted or on this Mac. A request goes down, tokens
  stream back up, first on one side, then the other.
- models-router.svg: `call_model` hands the router a name, the router picks a provider, and
  the reply streams back. First a local model, then a hosted one.
- models-keys.svg: how the router finds a provider's key at each call.
- models-local-server.svg: a local Ollama from start to stop, and the one golem never stops.

The look matches scripts/figures/agent_loop.py: golem's tokens, slip and kiln under
prefers-color-scheme, and a still figure under prefers-reduced-motion.

Run from the repo root: python3 scripts/figures/models.py docs/images
"""

import sys

from svg import (
    arrow_down,
    arrow_right,
    arrow_up,
    card,
    header,
    mover,
    outline,
    shown,
)


# --- Where a model runs -------------------------------------------------------------------


def where() -> str:
    def column(cx: float, title: str, big: str, sub: str, model: str, model_sub: str, facts: list[str], offset: float, local: bool) -> str:
        left = cx - 196
        parts = [
            f'<text class="mono label" x="{left}" y="44">{title}</text>',
            f'<text class="mono" x="{left}" y="88" font-size="32" style="fill:var(--clay-ink)">{big}</text>',
            f'<text x="{left}" y="114" font-size="15" class="muted">{sub}</text>',
        ]
        if local:
            parts.append(f'<rect x="{left}" y="140" width="392" height="200" rx="3" fill="var(--soft)"/>')
            parts.append(f'<text class="mono label" x="{left + 16}" y="162">THIS MAC</text>')
        else:
            parts.append(f'<path class="edge" d="M{left} 238 H{left + 392}"/>')
            parts.append(f'<text class="mono label" x="{left + 392}" y="260" text-anchor="end">THE INTERNET</text>')
        bx = cx - 90
        parts.append(f'<rect class="box" x="{bx}" y="172" width="180" height="44" rx="2"/>')
        parts.append(f'<text x="{cx}" y="200" text-anchor="middle" font-size="16">The agent</text>')
        parts.append(f'<rect class="box" x="{bx}" y="270" width="180" height="56" rx="2"/>')
        parts.append(f'<text x="{cx}" y="294" text-anchor="middle" font-size="16">{model}</text>')
        parts.append(f'<text class="mono small faint" x="{cx}" y="313" text-anchor="middle">{model_sub}</text>')
        parts.append(arrow_down(cx - 30, 216, 270))
        parts.append(arrow_up(cx + 30, 270, 216, back=True))
        parts.append(f'<text class="mono small faint" x="{cx - 38}" y="247" text-anchor="end">request</text>')
        parts.append(f'<text class="mono small faint" x="{cx + 38}" y="247">tokens</text>')
        for i, fact in enumerate(facts):
            y = 370 + i * 22
            parts.append(f'<rect class="dot" x="{left}" y="{y - 8}" width="6" height="6"/>')
            parts.append(f'<text x="{left + 16}" y="{y}" font-size="14" class="muted">{fact}</text>')
        o = offset
        anim = [mover(f"M{cx - 30} 216 V268", o + 0.04, o + 0.12)]
        anim.append(outline(bx - 4, 266, 188, 64, o + 0.12, o + 0.20))
        for i in range(6):
            start = o + 0.20 + i * 0.035
            anim.append(mover(f"M{cx + 30} 268 V218", start, start + 0.07, size=7))
        anim.append(outline(bx - 4, 168, 188, 52, o + 0.24, o + 0.44))
        parts.append(f'<g class="anim">{"".join(anim)}</g>')
        return "".join(parts)

    body = (
        column(228, "HOSTED", "pay per token", "the model runs on the provider's servers", "A hosted API", "anthropic · openai · …",
               ["big and fast", "needs an API key", "the conversation leaves your Mac"], 0.0, local=False)
        + '<path class="wire" d="M440 32 V438"/>'
        + column(652, "LOCAL", "free", "the model runs on your own Mac", "A local server", "ollama · lm studio",
                 ["private, and works offline", "no account, no key", "needs memory and disk"], 0.5, local=True)
    )
    return card(448, "Where a model runs: a hosted API on the provider's servers, paid per token, or a local server on your own Mac, free and private. In both, the request goes down and the tokens stream back.", body)


# --- The router ---------------------------------------------------------------------------

ROWS = [("ollama", "this Mac"), ("anthropic", "API key"), ("openai", "API key"), ("openrouter", "API key")]
ROW_Y = [158, 208, 258, 308]


def router() -> str:
    def cycle(o: float, row: int, profile: str, resolved: str) -> str:
        parts = [mover("M242 232 H298", o + 0.02, o + 0.07)]
        parts.append(outline(296, 196, 208, 72, o + 0.07, o + 0.13))
        parts.append(shown(f'<text class="mono small clay" x="400" y="254" text-anchor="middle">{profile} → {resolved}</text>', o + 0.07, o + 0.47))
        parts.append(mover(f"M500 232 H560 V{ROW_Y[row]} H618", o + 0.13, o + 0.21))
        parts.append(outline(616, ROW_Y[row] - 20, 228, 40, o + 0.21, o + 0.45))
        for i in range(5):
            start = o + 0.24 + i * 0.03
            parts.append(mover(f"M618 {ROW_Y[row]} H588 V284 H160 V268", start, start + 0.09, size=7))
        parts.append(shown('<text class="mono small clay" x="160" y="254" text-anchor="middle">streaming…</text>', o + 0.27, o + 0.45))
        return "".join(parts)

    rows = "".join(
        f'<rect class="box" x="620" y="{y - 16}" width="220" height="32" rx="2"/>'
        f'<text class="mono" x="634" y="{y + 5}" font-size="14">{name}</text>'
        f'<text class="mono small faint" x="828" y="{y + 4}" text-anchor="end">{how}</text>'
        for (name, how), y in zip(ROWS, ROW_Y, strict=True)
    )
    stubs = "".join(
        f'<path class="wire back" d="M588 {y} H616"/><path class="wire" d="M560 {y} H614"/>'
        f'<path class="head" d="M608 {y - 4} L615 {y} L608 {y + 4} Z"/>'
        for y in ROW_Y
    )
    body = f"""{header("ONE MODEL CALL", "1 router", "a name in, a chat model out, local or hosted")}
<rect x="40" y="150" width="500" height="150" rx="3" fill="var(--soft)"/>
<text x="60" y="180" font-size="17">In the daemon</text>
<rect class="box" x="80" y="200" width="160" height="64" rx="2"/>
<text class="mono" x="160" y="236" text-anchor="middle" font-size="16">call_model</text>
{arrow_right(240, 293, 232)}
<text class="mono label" x="268" y="222" text-anchor="middle" font-size="11">NAME</text>
<rect class="box" x="300" y="200" width="200" height="64" rx="2"/>
<text x="400" y="230" text-anchor="middle" font-size="17">Model router</text>
<path class="wire" d="M500 232 H560 M560 {ROW_Y[0]} V{ROW_Y[-1]}"/>
{stubs}
<text class="mono label" x="590" y="128" text-anchor="middle">PROVIDERS</text>
{rows}
<path class="wire back" d="M588 {ROW_Y[0]} V{ROW_Y[-1]} M588 284 H160 V270"/><path class="head" d="M156 276 L160 269 L164 276 Z"/>
<text class="mono label" x="370" y="318" text-anchor="middle">TOKENS STREAM BACK AS MESSAGE.DELTA</text>
<g class="anim">{cycle(0.0, 0, "qwen", "ollama/qwen3:8b")}{cycle(0.5, 1, "sonnet", "anthropic/…")}</g>"""
    return card(372, "golem's model router: call_model gives it a profile name, it resolves the name to a provider, local or hosted, and the reply streams back as tokens.", body)


# --- Finding a key ------------------------------------------------------------------------


def keys() -> str:
    def step(x: float, w: float, n: str, title: str, sub: str, fill: str = "var(--surface)") -> str:
        return (
            f'<rect x="{x}" y="132" width="{w}" height="76" rx="2" fill="{fill}"/>'
            f'<text class="mono small clay" x="{x + 16}" y="156">{n}</text>'
            f'<text x="{x + 16}" y="178" font-size="15">{title}</text>'
            f'<text class="mono small faint" x="{x + 16}" y="197">{sub}</text>'
        )

    chips = "".join(
        f'<rect x="340" y="{248 + i * 30}" width="260" height="24" rx="2" fill="var(--sunken)"/>'
        f'<text class="mono small" x="352" y="{264 + i * 30}">{name}</text>'
        f'<text class="mono small faint" x="588" y="{264 + i * 30}" text-anchor="end">{what}</text>'
        for i, (name, what) in enumerate([("provider/anthropic", "a model key"), ("mcp/github", "a token"), ("hook/deploy", "a token")])
    )
    # First pass: no variable, so the Keychain gives the key. Second pass: the variable is set, and wins.
    anim = (
        mover("M20 170 H40 V132 H300 V170 H340 V132 H600 V170 H640", 0.04, 0.40)
        + shown('<text class="mono small faint" x="170" y="228" text-anchor="middle">not set: look further</text>', 0.12, 0.42)
        + outline(336, 128, 268, 84, 0.28, 0.46)
        + outline(636, 128, 216, 84, 0.40, 0.48)
        + mover("M20 170 H40 V132 H170", 0.56, 0.64)
        + outline(36, 128, 268, 84, 0.64, 0.84)
        + shown('<text class="mono small clay" x="170" y="228" text-anchor="middle">set: it wins</text>', 0.64, 0.92)
    )
    body = f"""{header("AT EACH MODEL CALL", "2 places", "the router looks for a provider's key here, in order")}
{step(40, 260, "1", "An environment variable", "the one api_key_env names")}
{arrow_right(300, 339, 170)}
{step(340, 260, "2", "The macOS Keychain", "provider/&lt;name&gt;")}
{arrow_right(600, 639, 170)}
{step(640, 208, "→", "The key", "read for this call only", fill="var(--soft)")}
<text class="mono label" x="340" y="238">ONE STORE FOR EVERY SECRET · SERVICE GOLEM</text>
{chips}
<text class="mono label" x="40" y="264">NO KEY AT ALL</text>
<text x="40" y="286" font-size="14" class="muted">The call fails, and the error</text>
<text x="40" y="306" font-size="14" class="muted">names <tspan class="mono">/login &lt;provider&gt;</tspan>.</text>
<text x="640" y="264" font-size="14" class="muted">Never in a file: a setting</text>
<text x="640" y="284" font-size="14" class="muted">with a key in it does</text>
<text x="640" y="304" font-size="14" class="muted">not load.</text>
<g class="anim">{anim}</g>"""
    return card(352, "How golem finds a provider's key at each model call: first the environment variable that api_key_env names, then the macOS Keychain, where every secret golem keeps lives under one service. With no key, the call fails and names /login.", body)


# --- A local Ollama, start to stop --------------------------------------------------------


def local_server() -> str:
    stages = [
        ("Something needs it", ["a call, /model,", "or a download"]),
        ("Is one answering?", ["GET /api/tags"]),
        ("ollama serve", ["waits up to 60 s", "logs/ollama.log"]),
        ("Ready, and held", ["while calls", "use it"]),
        ("Stopped", ["after 30 idle min,", "or golem stops"]),
    ]
    x0, w, gap, top, h = 32, 144, 24, 150, 80
    xs = [x0 + i * (w + gap) for i in range(len(stages))]
    cy = top + h / 2
    boxes = ""
    for i, ((title, subs), x) in enumerate(zip(stages, xs, strict=True)):
        fill = "var(--soft)" if i == 3 else "var(--surface)"
        boxes += f'<rect x="{x}" y="{top}" width="{w}" height="{h}" rx="2" fill="{fill}"/>'
        boxes += f'<text x="{x + w / 2}" y="{top + 28}" text-anchor="middle" font-size="14">{title}</text>'
        for k, sub in enumerate(subs):
            boxes += f'<text class="mono small faint" x="{x + w / 2}" y="{top + 50 + k * 16}" text-anchor="middle">{sub}</text>'
        if i < len(stages) - 1:
            boxes += arrow_right(x + w, xs[i + 1], cy)
    boxes += f'<text class="mono small faint" x="{xs[1] + w + gap / 2}" y="{cy - 8}" text-anchor="middle">no</text>'
    mid1 = xs[1] + w / 2
    boxes += arrow_down(mid1, top + h, 282)
    boxes += f'<text class="mono small faint" x="{mid1 + 10}" y="260">yes</text>'
    boxes += (
        f'<rect x="{mid1 - 130}" y="282" width="260" height="54" rx="2" fill="var(--surface)"/>'
        f'<text x="{mid1}" y="305" text-anchor="middle" font-size="14">External: used, never stopped</text>'
        f'<text class="mono small faint" x="{mid1}" y="324" text-anchor="middle">brew services, the Ollama app</text>'
    )
    boxes += (
        '<text x="470" y="292" font-size="14" class="muted">golem keeps the pid of the one it started in</text>'
        '<text class="mono small" x="470" y="313">run/ollama-&lt;port&gt;.pid</text>'
        '<text x="470" y="334" font-size="14" class="muted">so a restarted daemon takes it back.</text>'
    )

    def lit(i: int, a: float, b: float) -> str:
        return outline(xs[i] - 3, top - 3, w + 6, h + 6, a, b)

    def hop(i: int, a: float, b: float) -> str:
        return mover(f"M{xs[i] + w} {cy} H{xs[i + 1]}", a, b)

    anim = (
        lit(0, 0.02, 0.08) + hop(0, 0.08, 0.12) + lit(1, 0.12, 0.17) + hop(1, 0.17, 0.21)
        + lit(2, 0.21, 0.32) + hop(2, 0.32, 0.36) + lit(3, 0.36, 0.48) + hop(3, 0.48, 0.52)
        + lit(4, 0.52, 0.60)
        + lit(0, 0.66, 0.71) + hop(0, 0.71, 0.75) + lit(1, 0.75, 0.80)
        + mover(f"M{mid1} {top + h} V280", 0.80, 0.85)
        + outline(mid1 - 133, 279, 266, 60, 0.85, 0.97)
    )
    body = f"""{header("A LOCAL OLLAMA, START TO STOP", "1 rule", "golem stops only a server it started")}
{boxes}
<g class="anim">{anim}</g>"""
    return card(360, "A local Ollama's life: when something needs it, golem checks whether one answers. If not, it runs ollama serve and waits up to 60 seconds, holds it while calls use it, and stops it after 30 idle minutes or when golem stops. A server that already answered is external: golem uses it and never stops it.", body)


out = sys.argv[1]
for name, svg in [
    ("models-where", where()),
    ("models-router", router()),
    ("models-keys", keys()),
    ("models-local-server", local_server()),
]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
