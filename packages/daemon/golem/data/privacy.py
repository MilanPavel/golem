"""Whether the rows of a data source may go to a model, and a first guess at a source's level.

Pure: no file, no clock, no network. Memory decides the same way (``golem.memory.privacy``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Literal

from golem.config import DataPrivacyLevel
from golem.memory.privacy import ChatPrivacy, Target, chat_is_local

RowsReason = Literal["source_local", "source_schema", "chat_local"]


@dataclass(frozen=True, slots=True)
class RowsVerdict:
    """``reason`` is None when allowed, else why the rows stay out of the model's copy."""

    allowed: bool
    reason: RowsReason | None = None


def may_use_rows(privacy: DataPrivacyLevel, chat: ChatPrivacy, target: Target) -> RowsVerdict:
    """Whether the rows of a source of this level may be shown to ``target``.

    Mirrors ``golem.memory.privacy.may_use``. ``schema`` goes to no model. A local model gets
    the rest. A hosted model gets nothing of a ``local`` source, and nothing at all in a chat
    that is local, so ``open`` rows reach it only in a chat that is not.
    """
    if privacy == "schema":
        return RowsVerdict(False, "source_schema")
    if target.local:
        return RowsVerdict(True)
    if privacy == "local":
        return RowsVerdict(False, "source_local")
    if chat_is_local(chat):
        return RowsVerdict(False, "chat_local")
    return RowsVerdict(True)


_PERSONAL = re.compile(
    r"amount|price|salary|balance|revenue|payment|money"
    r"|e[-_ ]?mail"
    r"|(^|[-_ ])(first|last|full|sur)?name$|^surname"
    r"|phone|mobile"
    r"|address|street|postcode|postal"
    r"|iban|account[-_ ]?number",
    re.IGNORECASE,
)
_FIXTURES = frozenset({"fixtures", "fixture", "seed", "seeds", "testdata", "test_data"})
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})
_URL = re.compile(r"^[a-z][a-z0-9+.-]*://(?:[^@/]*@)?(\[[^\]]+\]|[^/:?]+)", re.IGNORECASE)


def guess_privacy(
    location: str, columns: list[str] | None = None, *, home: Path | None = None
) -> tuple[DataPrivacyLevel, str]:
    """A first level for a new source, and one plain sentence for why.

    A column named like money, an email, a name, a phone, an address or an IBAN gives
    ``local``, and so does a path under the home folder. A database on this machine, or a file
    under a fixtures or seed folder, gives ``open``. Anything else gives ``local``: when golem
    cannot tell, the rows stay on this computer. ``home`` defaults to the user's home folder.
    """
    for column in columns or []:
        if _PERSONAL.search(column):
            article = "an" if column[:1].lower() in "aeiou" else "a"
            return "local", f"has {article} `{column}` column"
    found = _URL.match(location)
    if found is not None and found.group(1).lower() in _LOCAL_HOSTS:
        return "open", "a database on this computer"
    path = PurePath(location)
    if any(part.lower() in _FIXTURES for part in path.parts):
        return "open", "in a fixtures folder"
    base = home if home is not None else Path.home()
    expanded = PurePath(str(base) + location[1:]) if location.startswith("~") else path
    if expanded.is_absolute() and expanded.is_relative_to(base):
        return "local", "in your home folder"
    return "local", "golem cannot tell what is in it, so the rows stay on this computer"


__all__ = ["RowsReason", "RowsVerdict", "guess_privacy", "may_use_rows"]
