"""Draws the figures of docs/architecture/web.md as animated SVGs.

- web-reach.svg: a browser can't open a Unix socket, so a local server bridges it, and every
  page in the browser can reach that server. The three things it must check.
- web-gateway.svg: golem's gateway in three stages, from the page down: the login, the filter,
  and the bridge to the socket, with the real refusals each stage gave.
- web-login.svg: the login as a sequence over time, from `golem web` to the first `hello`.
- web-page.svg: inside the page. One client, and three kinds of state: session stores, the live
  store, and TanStack Query, under the components.

Run from the repo root: python3 scripts/figures/web.py docs/images
"""

import sys

from svg import arrow_down, arrow_left, arrow_right, arrow_up, card, facts, header, mover, outline, shown


def box(x: int, y: int, w: int, h: int, title: str, sub: str = "", mono: bool = False, soft: bool = False) -> str:
    cls = ' class="mono"' if mono else ""
    fill = ' style="fill:var(--soft)"' if soft else ""
    out = f'<rect class="box" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"{fill}/>'
    out += f'<text{cls} x="{x + 14}" y="{y + 24}" font-size="14">{title}</text>'
    if sub:
        out += f'<text class="small faint" x="{x + 14}" y="{y + 42}">{sub}</text>'
    return out


# --- A browser reaches a local agent, in agents generally --------------------------------------


def reach() -> str:
    parts = [
        '<text class="mono label" x="30" y="140">THE BROWSER</text>',
        '<text class="mono label" x="340" y="140">A LOCAL SERVER</text>',
        '<text class="mono label" x="650" y="140">THE AGENT</text>',
        '<rect x="30" y="152" width="250" height="262" rx="6" fill="var(--sunken)"/>',
        box(44, 166, 222, 56, "your agent's page", "opened by the agent's command"),
        box(44, 252, 222, 56, "a site you have open", "any tab, any origin"),
        box(44, 338, 222, 56, "a site that rebinds DNS", "evil.example → 127.0.0.1"),
        '<rect class="box" x="340" y="152" width="250" height="262" rx="2"/>',
        '<text class="mono" x="354" y="178" font-size="14">127.0.0.1:port</text>',
        '<text class="small faint" x="354" y="196">HTTP and WebSocket</text>',
        '<text class="mono small" x="354" y="236">who?</text>',
        '<text class="small faint" x="354" y="254">a secret only your page holds</text>',
        '<text class="mono small" x="354" y="292">from where?</text>',
        '<text class="small faint" x="354" y="310">the Origin and Host headers</text>',
        '<text class="mono small" x="354" y="348">may it?</text>',
        '<text class="small faint" x="354" y="366">which commands a page may send</text>',
        box(650, 166, 200, 56, "the agent", "a Unix socket or a pipe", soft=True),
        '<text class="small faint" x="650" y="252">A browser can open neither.</text>',
        '<text class="small faint" x="650" y="272">It speaks only HTTP and</text>',
        '<text class="small faint" x="650" y="292">WebSocket.</text>',
    ]
    parts.append(arrow_right(266, 338, 194))
    parts.append(arrow_right(590, 648, 194))
    parts.append('<path class="wire back" d="M266 280 H338"/><path class="head" d="M331 276 L338 280 L331 284 Z"/>')
    parts.append('<path class="wire back" d="M266 366 H338"/><path class="head" d="M331 362 L338 366 L331 370 Z"/>')
    parts.append(facts([
        "Loopback is not private. Every page in the browser can send a request to 127.0.0.1",
        "So the server checks who, from where, and what, on every request",
    ], 30, 452))
    anim = [
        mover("M266 194 H338", 0.04, 0.10),
        outline(346, 222, 238, 40, 0.10, 0.20),
        outline(346, 278, 238, 40, 0.20, 0.30),
        mover("M590 194 H648", 0.30, 0.36),
        outline(646, 162, 208, 64, 0.36, 0.46),
        mover("M266 280 H338", 0.52, 0.58),
        outline(346, 222, 238, 40, 0.58, 0.70),
        shown('<text class="mono small clay" x="460" y="236">no secret ✗</text>', 0.58, 0.72),
        mover("M266 366 H338", 0.76, 0.82),
        outline(346, 278, 238, 40, 0.82, 0.94),
        shown('<text class="mono small clay" x="460" y="292">wrong Host ✗</text>', 0.82, 0.96),
    ]
    body = f"""{header("IN AGENTS GENERALLY", "127.0.0.1", "every tab can knock")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        490,
        "A browser reaching a local agent. The agent listens on a Unix socket or a pipe, which a browser can't open: it speaks only HTTP and WebSocket. So a local server on 127.0.0.1 bridges the two. But every page in the browser can send a request to 127.0.0.1: your agent's page, any site you have open, and a site whose name is rebound to 127.0.0.1. So the server checks three things on every request: who, with a secret only your page holds; from where, with the Origin and Host headers; and what, with the list of commands a page may send.",
        body,
    )


# --- The gateway, in golem ---------------------------------------------------------------------

STAGES = [
    (130, "login", "Host and Origin exactly 127.0.0.1:port, and the cookie's secret"),
    (226, "filter", "one JSON object per message, no line break, a method a browser may call"),
    (322, "bridge", "one daemon connection per WebSocket, lines passed on unchanged"),
]


def gateway() -> str:
    parts = ['<text class="mono label" x="30" y="118">GOLEM WEB, 127.0.0.1:7480</text>']
    for y, name, sub in STAGES:
        parts.append(box(30, y, 540, 64, name, sub, mono=True))
    parts.append(box(30, 418, 540, 44, "golem.sock", "", mono=True))
    parts.append('<text class="small faint" x="160" y="446">the daemon, unchanged: no port, no cookie</text>')
    for y in (194, 290, 386):
        parts.append(arrow_down(300, y + 2, y + 24))
    parts.append('<text class="mono label" x="600" y="118">STOPPED HERE</text>')
    refusals = [
        (146, "Origin evil.example", "403 bad origin"),
        (182, "no cookie", "opened, then closed 4401"),
        (242, "two objects, one \\n", "closed 1008"),
        (278, "auth.set", "error -32020"),
        (338, "a tab that can't keep up", "pause the socket at 4 MiB"),
    ]
    for y, what, answer in refusals:
        parts.append(f'<text class="mono small" x="600" y="{y}">{what}</text>')
        parts.append(f'<text class="mono small clay" x="600" y="{y + 16}">{answer}</text>')
    parts.append(facts([
        "hello, session.create, session.attach, and message.send passed through unchanged",
        "67 deltas reached the page and a terminal client on the socket: the same 360 characters",
    ], 30, 500))
    anim = [
        mover("M300 100 V130", 0.02, 0.06),
        outline(26, 126, 548, 72, 0.06, 0.18),
        shown('<text class="mono small clay" x="440" y="154">cookie ✓</text>', 0.08, 0.18),
        mover("M300 196 V226", 0.18, 0.22),
        outline(26, 222, 548, 72, 0.22, 0.34),
        shown('<text class="mono small clay" x="400" y="250">message.send ✓</text>', 0.24, 0.34),
        mover("M300 292 V322", 0.34, 0.38),
        outline(26, 318, 548, 72, 0.38, 0.50),
        mover("M300 388 V418", 0.50, 0.54),
        outline(26, 414, 548, 52, 0.54, 0.62),
        # Two refusals: one at the door, one in the filter.
        outline(594, 132, 262, 38, 0.66, 0.78),
        outline(26, 126, 548, 72, 0.66, 0.78),
        outline(594, 264, 262, 38, 0.82, 0.94),
        outline(26, 222, 548, 72, 0.82, 0.94),
    ]
    body = f"""{header("THE GATEWAY, IN GOLEM", "3", "a door, a filter, a bridge")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        548,
        "golem's gateway, started by golem web on 127.0.0.1 port 7480, in three stages from the page down. The login checks that Host and Origin are exactly 127.0.0.1 and the port, and that the cookie names a live secret. The filter lets through one JSON object per message, with no line break, and only a method a browser may call. The bridge opens one daemon connection per WebSocket and passes lines on unchanged to golem.sock. The daemon is unchanged, with no port and no cookie. Real refusals: Origin evil.example got 403, an upgrade with no cookie was opened and closed with 4401, two objects joined by a newline closed the link with 1008, and auth.set got error -32020. A tab that can't keep up pauses the daemon socket at 4 MiB. hello, session.create, session.attach, and message.send passed through unchanged, and 67 deltas reached the page and a terminal client on the socket alike.",
        body,
    )


# --- The login, in golem -------------------------------------------------------------------------

LANES = [(90, "golem web"), (330, "page"), (570, "gateway"), (790, "daemon")]


def login() -> str:
    parts = []
    for x, name in LANES:
        parts.append(f'<rect class="box" x="{x - 64}" y="126" width="128" height="32" rx="2"/>')
        parts.append(f'<text class="mono" x="{x}" y="147" font-size="14" text-anchor="middle">{name}</text>')
        parts.append(f'<path class="edge" d="M{x} 158 V520"/>')
    rows = [
        # (y, from, to, label, back)
        (188, 90, 570, "start, or reuse the one in run/web.json", False),
        (252, 90, 330, "open 127.0.0.1:7480/#t=TOKEN", False),
        (290, 330, 570, "POST /auth/exchange {token}", False),
        (322, 570, 330, "204 Set-Cookie golem_7480=SECRET", True),
        (396, 330, 570, "GET /ws, with the cookie", False),
        (428, 570, 790, "connect golem.sock", False),
        (470, 330, 790, "hello, through the bridge", False),
        (504, 790, 330, "the reply, then the events", True),
    ]
    for y, a, b, label, back in rows:
        if a < b:
            parts.append(arrow_right(a, b, y))
        else:
            parts.append(arrow_left(a, b, y, back=back))
        lx = min(a, b) + 14
        parts.append(f'<text class="mono small" x="{lx}" y="{y - 7}">{label}</text>')
    # Steps inside one lane.
    parts.append('<rect class="box" x="604" y="202" width="232" height="26" rx="2" style="fill:var(--soft)"/>')
    parts.append('<text class="mono small" x="614" y="219">run/web.token, 0600, O_EXCL</text>')
    parts.append('<rect class="box" x="180" y="340" width="300" height="26" rx="2" style="fill:var(--soft)"/>')
    parts.append('<text class="mono small" x="190" y="357">replaceState: #t= leaves the address</text>')
    anim = []
    for k, (y, a, b, _label, _back) in enumerate(rows):
        s = 0.04 + k * 0.11
        anim.append(mover(f"M{a} {y} H{b}", s, s + 0.06))
    anim.append(outline(600, 198, 240, 34, 0.10, 0.18))
    anim.append(outline(176, 336, 308, 34, 0.42, 0.50))
    body = f"""{header("THE LOGIN, IN GOLEM", "#t=", "a token, then a cookie")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        548,
        "The login, over time, across four lanes: golem web, the page, the gateway, and the daemon. golem web starts the gateway, or reuses the one in run/web.json, and the gateway writes run/web.token with mode 0600 and O_EXCL. golem web opens 127.0.0.1 port 7480 with the token after the hash, which a browser never sends to a server. The page posts the token to /auth/exchange, and gets back 204 with a cookie that holds a fresh secret, not the token. The page removes the hash from the address with replaceState. Then it opens /ws with the cookie, the gateway connects to golem.sock, and the page's hello goes through the bridge to the daemon, which answers and sends the events.",
        body,
    )


# --- Inside the page, in golem -----------------------------------------------------------------


def page() -> str:
    parts = [
        box(30, 130, 820, 56, "features/ and ui/", "the screens and their primitives: React 19, Radix, Tailwind with golem's tokens only", mono=True),
        box(30, 236, 260, 92, "session stores", "one per attached session", mono=True),
        '<text class="small faint" x="44" y="296">reduceChat from @golem/view</text>',
        '<text class="small faint" x="44" y="314">deltas fold once per frame</text>',
        box(310, 236, 260, 92, "live store", "pushed, never stored", mono=True),
        '<text class="small faint" x="324" y="296">the link, the session list</text>',
        '<text class="small faint" x="324" y="314">downloads, server status</text>',
        box(590, 236, 260, 92, "TanStack Query", "pulled: a request, a reply", mono=True),
        '<text class="small faint" x="604" y="296">model.list, skill.list, …</text>',
        '<text class="small faint" x="604" y="314">stale when an event says so</text>',
        box(30, 378, 820, 56, "@golem/client", "the TUI's client, over wsDial: hello, the ping, the reconnect, seq order, repeats dropped", mono=True),
        box(30, 470, 820, 40, "the gateway's /ws", "", mono=True),
    ]
    for x in (160, 440, 720):
        parts.append(arrow_up(x, 376, 330))
        parts.append(arrow_up(x, 234, 188))
    parts.append(arrow_up(440, 468, 436))
    parts.append('<text class="small faint" x="172" y="360">session events</text>')
    parts.append('<text class="small faint" x="452" y="360">live facts</text>')
    parts.append('<text class="small faint" x="732" y="360">replies</text>')
    parts.append('<path class="wire back" d="M570 282 H589"/><path class="head" d="M582 278 L589 282 L582 286 Z"/>')
    parts.append('<text class="small faint" x="580" y="226" text-anchor="middle">invalidates</text>')
    parts.append(facts([
        "A hidden tab runs no frames, so any other event folds the waiting deltas first",
        "No optimistic updates: your line appears when message.completed comes back",
    ], 30, 548))
    anim = [
        mover("M440 468 V436", 0.04, 0.08),
        outline(26, 374, 828, 64, 0.08, 0.18),
        mover("M160 376 V330", 0.18, 0.24),
        outline(26, 232, 268, 100, 0.24, 0.36),
        shown('<text class="mono small clay" x="196" y="260">delta ×67</text>', 0.24, 0.36),
        mover("M160 234 V188", 0.36, 0.42),
        outline(26, 126, 828, 64, 0.42, 0.52),
        mover("M440 468 V436", 0.58, 0.62),
        mover("M440 376 V330", 0.62, 0.68),
        outline(306, 232, 268, 100, 0.68, 0.78),
        mover("M570 282 H590", 0.78, 0.82),
        outline(586, 232, 268, 100, 0.82, 0.94),
        shown('<text class="mono small clay" x="740" y="260">refetch</text>', 0.82, 0.94),
    ]
    body = f"""{header("INSIDE THE PAGE, IN GOLEM", "3", "kinds of state, one client")}
{"".join(parts)}
<g class="anim">{"".join(anim)}</g>"""
    return card(
        594,
        "Inside the page, from the gateway's /ws up. @golem/client, the same client the TUI uses, runs over wsDial: hello, the ping, the reconnect, seq order, and repeats dropped. It feeds three kinds of state. Session events go to session stores, one per attached session, folded by reduceChat from @golem/view, with deltas folded once per frame. Live facts go to the live store: the link, the session list, downloads, and server status, pushed and never stored. Replies go to TanStack Query: model.list, skill.list, and the rest, pulled with a request and marked stale when a pushed event says so. The screens in features and ui read from all three. A hidden tab runs no frames, so any other event folds the waiting deltas first. There are no optimistic updates: your line appears when message.completed comes back.",
        body,
    )


out = sys.argv[1]
for name, svg in [("web-reach", reach()), ("web-gateway", gateway()), ("web-login", login()), ("web-page", page())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
