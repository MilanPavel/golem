"""Draws the figures of docs/vision.md as animated SVGs, one per chapter.

- vision-doors.svg: one daemon, many doors. Each client in turn reaches the daemon, the
  terminal over the socket, everything else through a door of the gateway.
- vision-clients.svg: the Mac and the iPhone as one app family. An approval appears on the
  Mac, follows you to the phone's lock screen, Face ID allows it, and a Live Activity follows.
- vision-workflow.svg: a workflow's steps tick through, the daemon dies, the run resumes from
  its checkpoint, waits two days for a review, and posts exactly once.
- vision-subagents.svg: a parent splits a task between three sub-agents, each on its own
  model, as swimlanes. One asks for an approval that bubbles up; the summaries flow back.
- vision-serve.svg: serve mode. The deployment holds the gateway and the daemon only; the
  models are endpoints across a hard boundary, and the router picks one per request.
- vision-core.svg: the router sends each request to the cheapest model that can do it.

The look matches scripts/figures/agent_loop.py: golem's tokens, slip and kiln under
prefers-color-scheme, and a still figure under prefers-reduced-motion.

Run from the repo root: python3 scripts/figures/vision.py docs/images
"""

import sys

from svg import DUR, arrow_right, blink, card, header, grow, mover, outline, pixel_golem, shown


def box(x: float, y: float, w: float, h: float, extra: str = "") -> str:
    return f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="6"{extra}/>'


def text(x: float, y: float, s: str, cls: str = "small", anchor: str = "start", size: int | None = None) -> str:
    fs = f' font-size="{size}"' if size else ""
    return f'<text class="{cls}" x="{x}" y="{y}" text-anchor="{anchor}"{fs}>{s}</text>'


# --- One daemon, many doors ---------------------------------------------------------------

CLIENTS = [
    ("terminal", None),
    ("browser", "127.0.0.1 + token"),
    ("Mac app", "127.0.0.1 + token"),
    ("iPhone", "Wi-Fi · Tailscale · relay"),
    ("your app", "HTTPS + API key"),
]


def doors() -> str:
    parts = [
        text(30, 140, "CLIENTS", "mono label"),
        text(300, 196, "GATEWAY · INSIDE THE GOLEM BINARY", "mono label"),
        text(600, 132, "DAEMON", "mono label"),
        box(300, 206, 230, 230),
        box(600, 144, 250, 292),
        pixel_golem(689, 186, 8),
        text(725, 268, "rules · sessions · tools", "small muted", "middle"),
        text(725, 340, "speaks only", "small faint", "middle"),
        text(725, 358, "the golem protocol", "mono small clay", "middle"),
        text(725, 396, "no ports, no TLS, no logins", "small faint", "middle"),
    ]
    anim = []
    for i, (name, door) in enumerate(CLIENTS):
        y = 170 + i * 62
        parts.append(box(30, y - 20, 190, 40))
        parts.append(text(46, y + 5, name, "mono small"))
        o = 0.04 + i * 0.18
        anim.append(outline(26, y - 24, 198, 48, o, o + 0.15))
        if door is None:
            parts.append(arrow_right(220, 600, y))
            parts.append(text(410, y - 8, "the Unix socket, as today", "small faint", "middle"))
            anim.append(mover(f"M220 {y} H598", o + 0.02, o + 0.10))
        else:
            parts.append(arrow_right(220, 300, y))
            parts.append(text(415, y + 5, door, "mono small muted", "middle"))
            parts.append(arrow_right(530, 600, y))
            anim.append(mover(f"M220 {y} H298", o + 0.02, o + 0.06))
            anim.append(outline(306, y - 16, 218, 32, o + 0.05, o + 0.12))
            anim.append(mover(f"M530 {y} H598", o + 0.09, o + 0.13))
        anim.append(outline(596, 140, 258, 300, o + 0.10, o + 0.16))
    body = f"""{header("ONE DAEMON, ONE PROTOCOL", "many doors", "every network door is the gateway")}
{"".join(parts)}
<text class="small muted" x="30" y="478">The daemon never changes. Tokens, pairing, and rate limits live in one program, next to the client.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        504,
        "Five clients reach one daemon. The terminal uses the Unix socket as today. The browser, the Mac app, the iPhone, and your app each come through a door of the gateway inside the golem binary: loopback with a token, Wi-Fi, Tailscale or a relay, and HTTPS with an API key. The daemon speaks only the golem protocol, with no ports, TLS, or logins.",
        body,
    )


# --- The Mac and the iPhone ---------------------------------------------------------------


def clients() -> str:
    parts = [
        # The Mac: a screen with a menu bar, and a stand.
        '<rect x="30" y="130" width="400" height="250" rx="10" fill="var(--sunken)"/>',
        '<rect x="40" y="140" width="380" height="22" fill="var(--surface)"/>',
        pixel_golem(386, 144, 2),
        text(52, 156, "golem", "mono small muted"),
        text(374, 156, "$0.02", "mono small faint", "end"),
        '<rect x="200" y="380" width="60" height="18" fill="var(--sunken)"/>',
        '<rect x="170" y="398" width="120" height="6" rx="3" fill="var(--line)"/>',
        # A chat window on the Mac's screen.
        box(56, 262, 350, 100),
        text(72, 288, "golem › fix the flaky test", "mono small muted"),
        text(72, 312, "● read test_runner.py", "mono small faint"),
        text(72, 334, "● edit_file: 1 change, approved", "mono small faint"),
        text(72, 356, "● shell: pytest -q …", "mono small faint"),
        text(230, 430, "Mac: menu bar · hotkey · notifications", "small muted", "middle"),
        # The iPhone.
        '<rect x="640" y="118" width="190" height="310" rx="26" fill="var(--sunken)"/>',
        '<rect x="700" y="128" width="70" height="14" rx="7" fill="var(--line)"/>',
        text(735, 186, "9:41", "mono", "middle", 34),
        text(735, 450, "iPhone: lock screen · Face ID", "small muted", "middle"),
        # The shared Swift package between them.
        box(470, 300, 130, 64),
        text(535, 326, "GolemKit", "mono small clay", "middle"),
        text(535, 346, "shared SwiftUI", "small faint", "middle"),
        '<path class="edge" d="M430 332 H470"/><path class="edge" d="M600 332 H640"/>',
        text(535, 220, "relay", "mono small muted", "middle"),
        text(535, 238, "end to end", "small faint", "middle"),
        '<path class="edge" d="M430 250 H640"/>',
    ]

    def note(x: float, y: float, w: float) -> str:
        """The notification card, on the Mac and on the lock screen."""
        return (
            box(x, y, w, 74, ' stroke="var(--clay)"')
            + pixel_golem(x + 12, y + 12, 2)
            + text(x + 36, y + 24, "golem", "mono small muted")
            + text(x + 10, y + 48, "May I run pytest -q?", "mono small")
        )

    mac_note = (
        note(190, 176, 220)
        + '<rect x="202" y="232" width="94" height="14" rx="3" fill="var(--soft)"/>'
        + text(249, 243, "allow", "mono small clay", "middle")
        + '<rect x="304" y="232" width="94" height="14" rx="3" fill="var(--sunken)"/>'
        + text(351, 243, "deny", "mono small faint", "middle")
    )
    anim = [
        f'<g opacity="0">{mac_note}{blink(0.04, 0.30)}</g>',
        shown(text(230, 300, "you left the desk…", "small faint", "middle"), 0.18, 0.32),
        mover("M430 250 H640", 0.30, 0.38),
        f'<g opacity="0">{note(648, 212, 174)}{blink(0.38, 0.62)}</g>',
        f'<g opacity="0"><rect x="711" y="306" width="48" height="48" rx="10" fill="none" stroke="var(--clay)" stroke-width="2.5"/>'
        f'<rect x="725" y="322" width="4" height="8" class="dot"/><rect x="741" y="322" width="4" height="8" class="dot"/>'
        f'<path d="M725 340 Q735 348 745 340" fill="none" stroke="var(--clay)" stroke-width="2.5"/>'
        f'{blink(0.48, 0.62)}</g>',
        shown(text(735, 378, "Face ID · allowed", "mono small clay", "middle"), 0.56, 0.64),
        mover("M640 250 H432", 0.62, 0.70),
        f'<g opacity="0">{box(652, 212, 166, 74)}'
        + pixel_golem(664, 224, 2)
        + text(688, 236, "running tests", "mono small muted")
        + text(664, 266, "step 4 of 9", "small faint")
        + '<rect x="664" y="274" width="142" height="4" rx="2" fill="var(--line)"/>'
        + grow(664, 274, 142, 4, [(0, 0.44), (0.70, 0.44), (0.95, 1.0), (1, 1.0)])
        + f"{blink(0.70, 0.96)}</g>",
        shown(text(230, 210, "approved on iPhone · tests running", "mono small clay", "middle"), 0.70, 0.96),
    ]
    body = f"""{header("ONE APP FAMILY", "Mac + iPhone", "SwiftUI, one shared package")}
{"".join(parts)}
<text class="small muted" x="30" y="482">The approval follows you. Whichever device answers first, the daemon hears it once.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        506,
        "A Mac and an iPhone share one SwiftUI package, GolemKit. An approval, May I run pytest -q, appears on the Mac. You have left the desk, so it travels through the relay, end to end encrypted, to the phone's lock screen. Face ID allows it, the Mac shows that it was approved on the iPhone, and a Live Activity shows the tests running.",
        body,
    )


# --- A workflow ---------------------------------------------------------------------------

STEPS = [
    (30, 120, "mon 06:00", "schedule"),
    (190, 130, "list outdated", "plain code"),
    (360, 150, "upgrade", "5 sub-agents"),
    (550, 130, "review", "you"),
    (720, 130, "open PRs", "once"),
]


def workflow() -> str:
    parts = [text(30, 152, "STEPS · YOUR CODE PUTS THEM IN ORDER", "mono label")]
    for i, (x, w, name, who) in enumerate(STEPS):
        parts.append(box(x, 172, w, 70))
        parts.append(text(x + 14, 202, name, "mono small"))
        parts.append(text(x + 14, 224, who, "small faint"))
        parts.append(f'<rect x="{x + w / 2 - 6}" y="292" width="12" height="12" rx="2" fill="none" stroke="var(--line)"/>')
        if i:
            px, pw = STEPS[i - 1][0], STEPS[i - 1][1]
            parts.append(arrow_right(px + pw, x, 207))
    parts.append('<path class="edge" d="M36 298 H844"/>')
    parts.append(text(30, 330, "checkpoint after every step", "small faint"))

    def saved(i: int, t: float) -> str:
        x, w = STEPS[i][0], STEPS[i][1]
        return f'<rect class="dot" x="{x + w / 2 - 4}" y="294" width="8" height="8" opacity="0">{blink(t, 0.97)}</rect>'

    def lit(i: int, a: float, b: float) -> str:
        x, w = STEPS[i][0], STEPS[i][1]
        return outline(x - 4, 168, w + 8, 78, a, b)

    bars = "".join(
        grow(374 + k * 25, 230, 20, 4, [(0, 0), (0.24 + k * 0.015, 0), (0.30 + k * 0.012, 1), (0.97, 1), (1, 0)]) for k in range(5)
    )
    anim = [
        lit(0, 0.03, 0.10), saved(0, 0.09),
        mover("M150 207 H188", 0.10, 0.13),
        lit(1, 0.13, 0.22), saved(1, 0.21),
        mover("M320 207 H358", 0.22, 0.24),
        lit(2, 0.24, 0.34), bars, saved(2, 0.33),
        f'<rect x="0" y="100" width="880" height="320" fill="var(--clay)" opacity="0">'
        f'<animate attributeName="opacity" dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.36;0.37;0.40;1" values="0;0;0.18;0;0"/></rect>',
        shown(text(30, 372, "✕  the daemon dies: kill -9, a crash, an upgrade", "mono small clay"), 0.37, 0.47),
        shown(text(30, 372, "↻  it comes back and resumes after step 3. Nothing runs twice.", "mono small clay"), 0.47, 0.58),
        mover("M510 207 H548", 0.56, 0.59),
        lit(3, 0.59, 0.80),
        shown(text(615, 270, "waiting · 2 days", "small clay", "middle"), 0.60, 0.72),
        shown(text(615, 270, "approved on iPhone", "small clay", "middle"), 0.72, 0.80),
        saved(3, 0.79),
        mover("M680 207 H718", 0.80, 0.83),
        lit(4, 0.83, 0.95), saved(4, 0.92),
        shown(text(785, 270, "4 PRs, opened once", "small clay", "middle"), 0.86, 0.97),
    ]
    body = f"""{header("A WORKFLOW", "durable", "it waits for you, and acts once")}
{"".join(parts)}
<text class="small muted" x="30" y="430">Steps call tools, models, or whole agents. The order is code, so it is the same every Monday.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        456,
        "Dependency upgrades as a workflow: a schedule on Monday at 06:00, list the outdated packages with plain code, upgrade them with five sub-agents, a review by you, and open the pull requests once. A checkpoint is saved after every step. The daemon dies after step 3, comes back, and resumes without running anything twice. The review waits two days until it is approved on the iPhone, and four pull requests are opened exactly once.",
        body,
    )


# --- Sub-agents ---------------------------------------------------------------------------

LANES = [
    ("explorer", "qwen3:8b · local", "find what the upgrade breaks", "$0.00"),
    ("worker", "qwen3-coder · local", "upgrade httpx in a worktree", "$0.00"),
    ("reviewer", "claude · hosted", "check the diff", "$0.03"),
]
LANE_Y = [176, 270, 364]


def subagents() -> str:
    parts = [
        text(30, 140, "PARENT", "mono label"),
        text(300, 140, "SUB-AGENTS · ONE LANE EACH", "mono label"),
        box(30, 152, 230, 280),
        pixel_golem(91, 176, 12),
        text(145, 274, "upgrade the outdated", "small", "middle"),
        text(145, 292, "dependencies", "small", "middle"),
        text(145, 318, "plans · hosted model", "small faint", "middle"),
    ]
    for (name, model, task, cost), y in zip(LANES, LANE_Y, strict=True):
        parts.append(box(300, y - 24, 550, 74))
        parts.append(pixel_golem(314, y - 10, 4, "var(--clay-ink)"))
        parts.append(text(360, y - 2, name, "mono small"))
        parts.append(text(360, y + 16, model, "small faint"))
        parts.append(text(520, y - 2, task, "small muted"))
        parts.append(f'<rect x="520" y="{y + 12}" width="250" height="6" rx="3" fill="var(--sunken)"/>')
        parts.append(text(836, y + 18, cost, "mono small", "end"))
        parts.append(f'<path class="edge" d="M260 {y} H300"/>')

    def lane(i: int) -> float:
        """The y of lane i's progress bar."""
        return LANE_Y[i] + 15

    anim = [
        outline(26, 148, 238, 288, 0.02, 0.10),
        *(mover(f"M262 {y} H298", 0.05, 0.10) for y in LANE_Y),
        grow(520, lane(0) - 3, 250, 6, [(0, 0), (0.10, 0), (0.40, 1), (0.98, 1), (1, 0)]),
        shown(text(836, LANE_Y[0] - 2, "done", "mono small clay", "end"), 0.40, 0.98),
        mover(f"M298 {LANE_Y[0]} H262", 0.40, 0.46),
        grow(520, lane(1) - 3, 250, 6, [(0, 0), (0.10, 0), (0.30, 0.45), (0.55, 0.45), (0.70, 1), (0.98, 1), (1, 0)]),
        outline(296, LANE_Y[1] - 28, 558, 82, 0.30, 0.55),
        shown(text(836, LANE_Y[1] - 2, "may I run uv lock?", "mono small clay", "end"), 0.30, 0.55),
        mover(f"M298 {LANE_Y[1]} H262", 0.31, 0.36),
        shown(text(145, 352, "↑ worker asks: uv lock", "mono small clay", "middle"), 0.36, 0.55),
        shown(text(145, 372, "you allow, on any screen", "small clay", "middle"), 0.44, 0.55),
        mover(f"M262 {LANE_Y[1]} H298", 0.50, 0.55),
        shown(text(836, LANE_Y[1] - 2, "done · 1 diff", "mono small clay", "end"), 0.70, 0.98),
        mover(f"M298 {LANE_Y[1]} H262", 0.70, 0.76),
        mover(f"M262 {LANE_Y[2]} H298", 0.70, 0.74),
        grow(520, lane(2) - 3, 250, 6, [(0, 0), (0.74, 0), (0.88, 1), (0.98, 1), (1, 0)]),
        shown(text(836, LANE_Y[2] - 2, "approved", "mono small clay", "end"), 0.88, 0.98),
        mover(f"M298 {LANE_Y[2]} H262", 0.88, 0.93),
        shown(text(145, 352, "3 summaries · 1 diff", "mono small clay", "middle"), 0.92, 0.99),
        shown(text(145, 372, "$0.03 · 4 min", "small clay", "middle"), 0.92, 0.99),
    ]
    body = f"""{header("SUB-AGENTS", "many hands", "small briefs, small models, one bill")}
{"".join(parts)}
<text class="small muted" x="30" y="474">Each child starts from a short brief, not the whole chat, so a small local model can do it well.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        500,
        "A parent golem plans an upgrade of the outdated dependencies and hands three sub-agents a brief each, shown as swimlanes. The explorer, on a local qwen3:8b, finds what breaks. The worker, on a local qwen3-coder, upgrades httpx in a worktree, and asks may I run uv lock; the approval bubbles up to the parent and you allow it. The reviewer, on a hosted model, checks the diff. Three summaries and one diff come back, for three cents in four minutes.",
        body,
    )


# --- Serve mode ---------------------------------------------------------------------------

ENDPOINTS = [
    ("your GPU box", "vLLM · Qwen3"),
    ("hosted", "Anthropic"),
    ("hosted", "OpenAI, Gemini, …"),
]
END_Y = [190, 280, 370]


def serve() -> str:
    parts = [
        text(30, 140, "YOUR APP", "mono label"),
        box(30, 152, 150, 120),
        '<rect x="44" y="170" width="90" height="16" rx="8" fill="var(--sunken)"/>',
        '<rect x="70" y="196" width="96" height="16" rx="8" fill="var(--soft)"/>',
        '<rect x="44" y="222" width="76" height="16" rx="8" fill="var(--sunken)"/>',
        text(105, 296, "REST · SSE", "mono small faint", "middle"),
        text(105, 314, "/v1/chat/completions", "mono small faint", "middle"),
        # The deployment: a container with the gateway and the daemon, and nothing else.
        '<rect x="220" y="128" width="340" height="310" rx="10" fill="none" stroke="var(--line)" stroke-width="1.4" stroke-dasharray="6 5"/>',
        text(236, 152, "THE DEPLOYMENT · CPU ONLY", "mono label"),
        box(240, 172, 110, 70),
        text(295, 204, "gateway", "mono small", "middle"),
        text(295, 224, "API keys", "small faint", "middle"),
        box(380, 172, 160, 240),
        pixel_golem(424, 192, 8),
        text(460, 266, "daemon", "mono small", "middle"),
        text(460, 290, "agents/support.md", "mono small faint", "middle"),
        text(460, 312, "rules · sessions", "small faint", "middle"),
        box(396, 340, 128, 52, ' stroke="var(--clay)"'),
        text(460, 362, "router", "mono small clay", "middle"),
        text(460, 380, "picks per request", "small faint", "middle"),
        box(240, 270, 110, 70),
        text(295, 300, "owner queue", "mono small", "middle"),
        text(295, 320, "risky steps", "small faint", "middle"),
        arrow_right(180, 240, 207),
        arrow_right(350, 380, 207),
        # The boundary.
        '<path d="M600 120 V446" stroke="var(--clay)" stroke-width="3" stroke-dasharray="10 6"/>',
        text(610, 438, "the boundary", "mono small clay"),
        text(30, 474, "No model inside the deployment. Models are endpoints by URL: swap one, and nothing redeploys.", "small muted"),
    ]
    for (where, what), y in zip(ENDPOINTS, END_Y, strict=True):
        parts.append(box(660, y - 30, 190, 60))
        parts.append(text(676, y - 6, where, "mono small"))
        parts.append(text(676, y + 14, what, "small faint"))
        parts.append(f'<path class="edge" d="M524 366 C590 366 600 {y} 660 {y}"/>')
    anim = [
        mover("M180 207 H240", 0.03, 0.07),
        mover("M350 207 H380", 0.07, 0.10),
        outline(392, 336, 136, 60, 0.10, 0.44),
        shown(text(460, 330, "a simple question", "small clay", "middle"), 0.10, 0.40),
        mover(f"M524 366 C590 366 600 {END_Y[0]} 660 {END_Y[0]}", 0.13, 0.19),
        outline(656, END_Y[0] - 34, 198, 68, 0.19, 0.40),
        *(mover(f"M660 {END_Y[0]} C600 {END_Y[0]} 590 366 524 366", 0.22 + k * 0.03, 0.27 + k * 0.03, 6) for k in range(4)),
        shown(text(836, END_Y[0] + 48, "$0.00", "mono small clay", "end"), 0.24, 0.42),
        mover("M240 207 H180", 0.38, 0.43),
        mover("M180 207 H240", 0.50, 0.54),
        mover("M350 207 H380", 0.54, 0.57),
        outline(392, 336, 136, 60, 0.57, 0.94),
        shown(text(460, 330, "a hard one: step up", "small clay", "middle"), 0.57, 0.92),
        mover(f"M524 366 C590 366 600 {END_Y[1]} 660 {END_Y[1]}", 0.60, 0.66),
        outline(656, END_Y[1] - 34, 198, 68, 0.66, 0.90),
        *(mover(f"M660 {END_Y[1]} C600 {END_Y[1]} 590 366 524 366", 0.69 + k * 0.03, 0.74 + k * 0.03, 6) for k in range(4)),
        shown(text(836, END_Y[1] + 48, "$0.004 · in budget", "mono small clay", "end"), 0.71, 0.94),
        mover("M240 207 H180", 0.86, 0.91),
    ]
    body = f"""{header("SERVE MODE", "agent | model", "a hard line between them")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        500,
        "Serve mode. Your app calls the deployment over REST, SSE, or the chat completions API. The deployment holds only the gateway, an owner queue, and the daemon with its agent file and router, on CPU. Across a hard boundary sit the models, as endpoints: your own GPU box with vLLM and Qwen3, and hosted providers. A simple question goes to the GPU box for nothing; a hard one steps up to a hosted model, within budget.",
        body,
    )


# --- The router ---------------------------------------------------------------------------

REQUESTS = [
    ("rename a variable", -38, "local · qwen3:8b", "$0.000"),
    ("read a receipt (private)", -38, "local · stays on the Mac", "$0.000"),
    ("summarize a long log", -12, "local · bigger, slower", "$0.000"),
    ("plan a migration", 38, "hosted · steps up", "$0.021"),
]


def core() -> str:
    cx, cy = 440, 300
    parts = [
        text(30, 140, "REQUESTS", "mono label"),
        text(cx, 140, "THE ROUTER", "mono label", "middle"),
        text(620, 140, "WHERE IT RAN", "mono label"),
        box(30, 220, 260, 120),
        f'<path d="M{cx - 120} {cy} A120 120 0 0 1 {cx + 120} {cy}" fill="none" stroke="var(--line)" stroke-width="10"/>',
        f'<path d="M{cx + 46} {cy - 111} A120 120 0 0 1 {cx + 120} {cy}" fill="none" stroke="var(--clay)" stroke-width="10"/>',
        text(cx - 126, cy + 26, "local", "mono small muted", "middle"),
        text(cx + 126, cy + 26, "hosted", "mono small muted", "middle"),
        text(cx, cy + 40, "cheapest model that can do it", "small faint", "middle"),
        f'<circle cx="{cx}" cy="{cy}" r="8" fill="var(--ink)"/>',
        box(620, 220, 230, 120),
        text(30, 392, "SPENT TODAY", "mono label"),
        '<rect x="30" y="404" width="820" height="10" rx="5" fill="var(--sunken)"/>',
        text(850, 392, "budget $1.00", "mono small faint", "end"),
    ]
    rots = []
    times = []
    for i, (_, a, _, _) in enumerate(REQUESTS):
        t = 0.04 + i * 0.23
        times += [t, t + 0.05]
        rots += [REQUESTS[i - 1][1] if i else 0, a]
    times = [0.0] + times + [0.97, 1.0]
    rots = [0] + rots + [REQUESTS[-1][1], 0]
    needle = (
        f'<g><path d="M{cx - 3} {cy} L{cx} {cy - 104} L{cx + 3} {cy} Z" fill="var(--ink)"/>'
        f'<animateTransform attributeName="transform" type="rotate" dur="{DUR}" repeatCount="indefinite" '
        f'keyTimes="{";".join(f"{t:.4f}" for t in times)}" values="{";".join(f"{r} {cx} {cy}" for r in rots)}"/></g>'
    )
    # The still figure (prefers-reduced-motion) shows the needle upright.
    still = f'<path class="still" d="M{cx - 3} {cy} L{cx} {cy - 104} L{cx + 3} {cy} Z" fill="var(--ink)"/>'
    anim = [needle]
    for i, (ask, _, where, cost) in enumerate(REQUESTS):
        t = 0.04 + i * 0.23
        anim.append(shown(text(46, 274, ask, "mono small"), t - 0.03, t + 0.20))
        anim.append(mover("M290 280 H316", t, t + 0.04))
        anim.append(shown(text(636, 268, where, "mono small"), t + 0.06, t + 0.21))
        anim.append(shown(text(834, 316, cost, "mono small clay", "end"), t + 0.06, t + 0.21))
        anim.append(mover("M566 280 H620", t + 0.04, t + 0.07))
    anim.append(grow(30, 404, 820, 10, [(0, 0), (0.75, 0), (0.80, 0.021), (0.97, 0.021), (1, 0)]))
    anim.append(shown(text(30, 440, "four answers, two cents, one of them private", "mono small clay"), 0.80, 0.97))
    body = f"""{header("THE CORE", "cheap first", "step up only when it pays off")}
{"".join(parts)}
<style>.still {{ display:none }} @media (prefers-reduced-motion: reduce) {{ .still {{ display:inline }} }}</style>{still}
<g class="anim">{"".join(anim)}</g>
<text class="small muted" x="30" y="470">You always see what each answer cost, and a budget stops the day before it surprises you.</text>"""
    return card(
        496,
        "The router as a gauge from local to hosted. Four requests in turn: rename a variable and read a private receipt go to a small local model for nothing, summarize a long log goes to a bigger local model, and plan a migration steps up to a hosted model for two cents. A bar shows the day's spend against a one dollar budget.",
        body,
    )


out = sys.argv[1]
for name, svg in [
    ("vision-doors", doors()),
    ("vision-clients", clients()),
    ("vision-workflow", workflow()),
    ("vision-subagents", subagents()),
    ("vision-serve", serve()),
    ("vision-core", core()),
]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
