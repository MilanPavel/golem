"""Draws the figures of docs/architecture/skills.md as animated SVGs.

- skills-levels.svg: progressive disclosure. One line per skill in every call, the body once a
  skill is used, and its files only when the body says to read them.
- skills-sources.svg: the skills one project folder sees, from one real skill.list: the
  project's, then the user's, then golem's own. The first working skill of a name wins.

Run from the repo root: python3 scripts/figures/skills.py docs/images
"""

import sys

from svg import card, header, mover, outline, shown

# --- Three levels, in agents generally ----------------------------------------------------

INDEX = [
    ("release-notes", "write release notes"),
    ("pdf-forms", "fill and read PDF forms"),
    ("terse", "short answers"),
    ("review", "review a diff"),
    ("deploy", "ship to staging"),
]
BODY = ["# Write release notes", "1. Read references/style.md", "2. Read CHANGES.txt", "3. One line per change"]
FILES = [("references/style.md", "read: the body says so"), ("scripts/changelog.sh", "never read this time")]


def levels() -> str:
    parts = [
        '<text class="mono label" x="30" y="146">1 · INDEX</text>',
        '<text class="mono label" x="330" y="146">2 · BODY</text>',
        '<text class="mono label" x="620" y="146">3 · FILES</text>',
    ]
    for i, (name, desc) in enumerate(INDEX):
        y = 160 + i * 40
        parts.append(f'<rect class="box" x="30" y="{y}" width="250" height="32" rx="2"/>')
        parts.append(f'<text class="mono small" x="42" y="{y + 20}">{name}</text>')
        parts.append(f'<text class="small faint" x="268" y="{y + 20}" text-anchor="end">{desc}</text>')
    parts.append('<rect class="box" x="330" y="160" width="240" height="152" rx="2"/>')
    for j, line in enumerate(BODY):
        cls = "mono small" if j else "mono small clay"
        parts.append(f'<text class="{cls}" x="344" y="{188 + j * 30}">{line}</text>')
    parts.append('<path class="edge" d="M280 176 H330"/>')
    parts.append('<path class="edge" d="M570 233 H620"/>')
    for k, (name, sub) in enumerate(FILES):
        y = 200 + k * 70
        parts.append(f'<rect class="box" x="620" y="{y}" width="230" height="52" rx="2"/>')
        parts.append(f'<text class="mono small" x="634" y="{y + 22}">{name}</text>')
        parts.append(f'<text class="small faint" x="634" y="{y + 40}">{sub}</text>')
    costs = [(30, "a line per skill, in every call"), (330, "the whole body, once it is used"), (620, "only what the body asks for")]
    for x, text in costs:
        parts.append(f'<text class="small muted" x="{x}" y="380">{text}</text>')
    anim = [
        outline(26, 156, 258, 40, 0.06, 0.92),
        shown('<text class="mono small clay" x="30" y="404">→ the model picks release-notes</text>', 0.10, 0.30),
        mover("M280 176 H328", 0.22, 0.28),
        outline(326, 156, 248, 160, 0.28, 0.92),
        outline(336, 212, 228, 28, 0.42, 0.56),
        mover("M570 233 H618", 0.52, 0.58),
        outline(616, 196, 238, 60, 0.58, 0.92),
        shown('<text class="mono small clay" x="620" y="404">→ one file read, one never</text>', 0.62, 0.92),
    ]
    body = f"""{header("IN AGENTS GENERALLY", "3 levels", "each read only when it is needed")}
{"".join(parts)}
<text class="small muted" x="30" y="440">Fifty skills cost fifty short lines. Only the one in use costs its whole body.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        466,
        "Progressive disclosure in three levels. The index, one line per skill, goes into every call. When the model picks release-notes, its body is read. The body says to read references/style.md, so that one file is read, and scripts/changelog.sh never is.",
        body,
    )


# --- Who wins a name, from one real skill.list --------------------------------------------

ROWS = [
    ("1 · THE PROJECT", ".golem/skills/release-notes", "release-notes", "wins", True),
    (None, ".golem/skills/terse", "terse", "wins", True),
    (None, ".agents/skills/Notes", "Notes", "broken: the name must be lowercase", False),
    ("2 · YOU", "~/.golem/skills/release-notes", "release-notes", "shadowed by the project's", False),
    ("3 · GOLEM", "bundled with golem", "", "none yet (step 2.7)", None),
]
ROW_Y = [186, 230, 274, 346, 418]


def sources() -> str:
    parts = [
        '<text class="mono label" x="470" y="146">THE VIEW FOR proj/</text>',
    ]
    anim = []
    for i, ((group, path, name, verdict, ok), y) in enumerate(zip(ROWS, ROW_Y, strict=True)):
        if group:
            parts.append(f'<text class="mono label" x="30" y="{y - 32}">{group}</text>')
        faint = " faint" if ok is None else ""
        parts.append(f'<rect class="box" x="30" y="{y - 18}" width="300" height="36" rx="2"/>')
        parts.append(f'<text class="mono small{faint}" x="44" y="{y + 4}">{path}</text>')
        parts.append(f'<path class="edge" d="M330 {y} H470"/>')
        stroke = ' stroke="var(--clay)"' if ok else ""
        parts.append(f'<rect class="box" x="470" y="{y - 18}" width="380" height="36" rx="2"{stroke}/>')
        if name:
            parts.append(f'<text class="mono small" x="484" y="{y + 4}">{name}</text>')
        cls = "clay" if ok else "faint"
        parts.append(f'<text class="small {cls}" x="836" y="{y + 4}" text-anchor="end">{verdict}</text>')
        o = 0.04 + i * 0.18
        anim.append(outline(26, y - 22, 308, 44, o, o + 0.10))
        anim.append(mover(f"M330 {y} H468", o + 0.06, o + 0.11))
        anim.append(outline(466, y - 22, 388, 44, o + 0.11, o + 0.17))
    anim.append(shown('<text class="mono small clay" x="850" y="146" text-anchor="end">2 usable, 2 listed with why</text>', 0.80, 0.97))
    body = f"""{header("ONE FOLDER IN GOLEM", "first wins", "a broken skill never does")}
{"".join(parts)}
<text class="small muted" x="30" y="468">Real, from skill.list. Every skill that lost stays in the list, with the reason.</text>
<g class="anim">{"".join(anim)}</g>"""
    return card(
        492,
        "The skills one project folder sees, from a real skill.list. The project's folders come first: release-notes and terse win, and Notes is broken because its name must be lowercase. The user's own release-notes is shadowed by the project's. Golem bundles none yet.",
        body,
    )



out = sys.argv[1]
for name, svg in [("skills-levels", levels()), ("skills-sources", sources())]:
    open(f"{out}/{name}.svg", "w").write(svg)
print("ok")
