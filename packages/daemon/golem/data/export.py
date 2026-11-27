"""Where a result may be written: the rules for the path of an export.

An export makes a new file on the person's disk, so its path follows the rules of
``write_file`` (a folder of the session or of the home folder, never a credentials folder or a
``.git`` or ``.golem`` one), and three more: the file must not exist, it must not be in a system
folder, and it must not be where a data source reads, so a source is never written to.
"""

from __future__ import annotations

import re
import tempfile
from collections.abc import Sequence
from fnmatch import fnmatchcase
from pathlib import Path

from golem.data.types import DataError

FORMATS = ("csv", "parquet", "json", "xlsx")
_SUFFIXES = {
    ".csv": "csv",
    ".parquet": "parquet",
    ".json": "json",
    ".jsonl": "json",
    ".ndjson": "json",
    ".xlsx": "xlsx",
}
_SYSTEM_FOLDERS = (
    "/etc", "/System", "/private", "/var", "/usr", "/bin", "/sbin", "/dev", "/proc", "/sys",
    "/boot", "/Library", "/Applications",
)  # fmt: skip
_WILDCARD = re.compile(r"[*?\[]")
KNOWN = "golem writes .csv, .parquet, .json, .jsonl and .xlsx files."


def infer_format(path: str) -> str:
    """The format a file name asks for. Raises :class:`DataError` for a name that asks for none."""
    found = _SUFFIXES.get(Path(path).suffix.lower())
    if found is None:
        raise DataError(f"Cannot tell the format from {path}. {KNOWN} Name the format.")
    return found


def target_path(raw: str, root: Path | None, locations: Sequence[str] = ()) -> Path:
    """The new file ``raw`` names, resolved. Raises :class:`DataError` with a sentence.

    A relative path is relative to ``root``, the session folder. ``locations`` are the places
    the data sources read.
    """
    from golem.tools.paths import CREDENTIALS, PROTECTED_DIRS, in_secret_dir

    text = raw.strip()
    if not text:
        raise DataError("Give the path of the file to write.")
    try:
        candidate = Path(text).expanduser()
        if not candidate.is_absolute():
            if root is None:
                raise DataError(
                    f"{text} is relative, and this chat has no project folder. "
                    "Give a full path, or one that starts with ~/."
                )
            candidate = root.resolve() / candidate
        name = candidate.name
        if name in ("", ".", ".."):
            raise DataError(f"{text} is a folder, not a file name.")
        folder = candidate.parent.resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        raise DataError(f"{text!r} is not a usable path: {exc}") from exc
    if not folder.is_dir():
        raise DataError(f"The folder {folder} does not exist. Make it first, or pick another.")
    target = folder / name
    _check_place(target, text, root)
    if in_secret_dir(target):
        raise DataError(CREDENTIALS.format(path=text))
    protected = next((p for p in target.parts if p.casefold() in PROTECTED_DIRS), None)
    if protected is not None:
        raise DataError(f"{text} is inside a {protected}/ folder, which golem does not change.")
    for location in locations:
        if _in_source(target, location):
            raise DataError(
                f"{target} is where the source at {location} reads, and a source is never "
                "written to. Pick a folder outside it."
            )
    if target.exists() or target.is_symlink():
        raise DataError(f"{target} already exists. golem does not overwrite a file.")
    return target


def _within(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def _check_place(target: Path, shown: str, root: Path | None) -> None:
    """Refuse a system folder, and anything outside the home and session folders."""
    allowed = [
        Path.home().resolve(),
        Path(tempfile.gettempdir()).resolve(),
        Path("/tmp").resolve(),
        Path("/var/tmp").resolve(),
    ]
    if root is not None:
        allowed.append(root.resolve())
    if any(_within(target, p) for p in allowed):
        return
    for folder in _SYSTEM_FOLDERS:
        if _within(target, Path(folder)):
            raise DataError(
                f"{shown} is in a system folder. Pick a folder of your own, "
                "such as one in your home folder."
            )
    raise DataError(f"{shown} is outside your home folder. Pick a folder inside it.")


def _in_source(target: Path, location: str) -> bool:
    """Whether a file at ``target`` would be read by the source at ``location``."""
    try:
        place = str(Path(location).expanduser())
        found = _WILDCARD.search(place)
        if found is None:
            real = Path(place).resolve()
            return _within(target, real)
        prefix = place[: found.start()]
        base = Path(prefix) if prefix.endswith("/") else Path(prefix).parent
        pattern = f"{base.resolve()}/{place[len(str(base)) :].lstrip('/')}"
        return fnmatchcase(str(target), pattern)
    except (OSError, RuntimeError, ValueError):
        return False


__all__ = ["FORMATS", "infer_format", "target_path"]
