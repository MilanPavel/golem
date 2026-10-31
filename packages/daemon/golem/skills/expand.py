"""Fill in a skill body with its arguments.

Pure: no disk, no clock, no session. The caller reads the body and passes in
what it needs.

- ``$ARGUMENTS`` is the whole argument string, as typed.
- ``$ARGUMENTS[N]`` and ``$N`` are the Nth argument, counted from 0, after a
  shell-style split, so ``"two words"`` is one argument. A missing one is empty.
- ``${CLAUDE_SKILL_DIR}`` and ``${GOLEM_SKILL_DIR}`` are the skill's folder.
- ``${CLAUDE_SESSION_ID}`` and ``${GOLEM_SESSION_ID}`` are the session ID.
- ``\\$`` is a literal ``$``, so ``\\$ARGUMENTS`` stays ``$ARGUMENTS``.
- `` !`cmd` `` is left exactly as it is. Running it comes later (2.6.4).

When arguments are given but the body uses none of the argument forms, they
are appended as ``ARGUMENTS: <args>``.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

_TOKEN = re.compile(
    r"""
    (?P<command>!`[^`\n]*`)                                  # !`cmd`, left alone
    | \\(?P<escaped>\$)                                      # \$ is a literal $
    | \$\{(?:CLAUDE|GOLEM)_(?P<var>SKILL_DIR|SESSION_ID)\}  # ${CLAUDE_SKILL_DIR}, ...
    | \$ARGUMENTS\[(?P<index>\d+)\]                          # $ARGUMENTS[0]
    | \$(?P<all>ARGUMENTS)(?![A-Za-z0-9_])                   # $ARGUMENTS
    | \$(?P<short>\d+)                                       # $0
    """,
    re.VERBOSE,
)


def split_arguments(args: str) -> list[str]:
    """Split ``args`` like a shell would, or on whitespace if the quotes do not close."""
    try:
        return shlex.split(args)
    except ValueError:
        return args.split()


def expand(body: str, args: str, *, skill_dir: Path | str, session_id: str) -> str:
    """Return ``body`` with its placeholders filled in from ``args``."""
    args = args.strip()
    words = split_arguments(args)
    used = False

    def nth(index: str) -> str:
        i = int(index)
        return words[i] if i < len(words) else ""

    def replace(match: re.Match[str]) -> str:
        nonlocal used
        if command := match["command"]:
            return command
        if match["escaped"]:
            return "$"
        if var := match["var"]:
            return str(skill_dir) if var == "SKILL_DIR" else session_id
        used = True
        if index := match["index"]:
            return nth(index)
        if match["all"]:
            return args
        return nth(match["short"])

    text = _TOKEN.sub(replace, body)
    if args and not used:
        head = text.rstrip()
        text = f"{head}\n\nARGUMENTS: {args}\n" if head else f"ARGUMENTS: {args}\n"
    return text


__all__ = ["expand", "split_arguments"]
