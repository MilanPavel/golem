"""The files of a session folder, for a client: ``file.read`` and ``file.list``.

Paths are checked by the same :class:`~golem.tools.paths.Readable` the model's
``read_file`` uses, and the walk skips the folders ``glob`` skips.
"""

from __future__ import annotations

from pathlib import Path

from golem.tools.fs import MAX_READ_BYTES, in_skipped_dir, walk_files
from golem.tools.paths import Readable
from golem.tools.registry import ToolError
from golem_protocol.commands import FileListResult, FileReadResult

MAX_TEXT_CHARS = 1_000_000
MAX_WALKED = 20_000


def read_text(folder: Path, path: str) -> FileReadResult:
    """The start of one file of ``folder``. Raises :class:`ToolError` when it cannot be shown."""
    where = Readable(root=folder)
    resolved = where.resolve(path)
    if not resolved.is_file():
        raise ToolError(f"{path} is not a file")
    if resolved.stat().st_size > MAX_READ_BYTES:
        raise ToolError(f"{path} is larger than {MAX_READ_BYTES // 1_000_000} MB")
    try:
        raw = resolved.read_bytes()
    except OSError as exc:
        raise ToolError(f"cannot read {path}: {exc.strerror or exc}") from exc
    if b"\0" in raw[:8192]:
        raise ToolError(f"{path} looks like a binary file")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ToolError(f"{path} is not UTF-8 text") from exc
    return FileReadResult(
        path=where.show(resolved),
        text=text[:MAX_TEXT_CHARS],
        truncated=len(text) > MAX_TEXT_CHARS,
        lines=len(text.splitlines()),
    )


def _has_dot_part(rel: Path) -> bool:
    return any(part.startswith(".") for part in rel.parts)


def list_paths(folder: Path, query: str, limit: int, hidden: bool = False) -> FileListResult:
    """Files of ``folder`` whose path holds ``query``, shortest first, then alphabetical.

    Dot files and files in dot folders are left out unless ``hidden`` is true.
    Dot folders are not walked then.
    """
    base = folder.resolve()
    needle = query.casefold()
    found: list[str] = []
    walked = 0
    cut = False
    for file in walk_files(base, hidden=hidden):
        walked += 1
        if walked > MAX_WALKED:
            cut = True
            break
        rel = file.relative_to(base)
        if in_skipped_dir(rel) or (not hidden and _has_dot_part(rel)):
            continue
        shown = rel.as_posix()
        if needle in shown.casefold():
            found.append(shown)
    found.sort(key=lambda shown: (len(shown), shown))
    return FileListResult(paths=found[:limit], more=cut or len(found) > limit)
