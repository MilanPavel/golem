"""Whether a memory may go to a model. Pure: no file, no clock, no network (ADR-061)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from golem.config import MemoryPrivacyLevel, MemoryScope, RouteMode

Reason = Literal["memory_local", "chat_local"]


@dataclass(frozen=True, slots=True)
class MemoryPrivacy:
    """What decides whether a memory is local.

    ``privacy`` is the record's own stamp, ``setting`` the ``[memory]`` setting of its scope.
    ``folder_local_only`` is for a project note in a local-only folder, and ``project_private``
    is the project's ``[memory] private = true``.
    """

    scope: MemoryScope
    privacy: MemoryPrivacyLevel = "chat"
    setting: MemoryPrivacyLevel = "chat"
    folder_local_only: bool = False
    project_private: bool = False


@dataclass(frozen=True, slots=True)
class ChatPrivacy:
    """The chat the memory was recalled in. ``model_local`` is the lead's model for this call."""

    local_only: bool = False
    route: RouteMode = "pinned"
    model_local: bool = False


@dataclass(frozen=True, slots=True)
class Target:
    """The model the text goes to. ``local`` is true for a local-tier model."""

    local: bool


@dataclass(frozen=True, slots=True)
class Verdict:
    """``reason`` is None when allowed, else why it is not."""

    allowed: bool
    reason: Reason | None = None


def effective_privacy(
    record_privacy: MemoryPrivacyLevel,
    scope_setting: MemoryPrivacyLevel,
    folder_local_only: bool,
    project_private: bool,
) -> MemoryPrivacyLevel:
    """The most private of the four: ``local`` when any of them says so."""
    if record_privacy == "local" or scope_setting == "local":
        return "local"
    if folder_local_only or project_private:
        return "local"
    return "chat"


def memory_is_local(memory: MemoryPrivacy) -> bool:
    level = effective_privacy(
        memory.privacy, memory.setting, memory.folder_local_only, memory.project_private
    )
    return level == "local"


def chat_is_local(chat: ChatPrivacy) -> bool:
    return chat.local_only or chat.route == "local" or chat.model_local


def may_use(memory: MemoryPrivacy, chat: ChatPrivacy, target: Target) -> Verdict:
    """Whether ``memory``, recalled in ``chat``, may be shown to ``target``.

    A local model always gets it. A hosted model gets it only when neither the memory nor the
    chat is local. When both are, the reason is ``memory_local``.
    """
    if target.local:
        return Verdict(True)
    if memory_is_local(memory):
        return Verdict(False, "memory_local")
    if chat_is_local(chat):
        return Verdict(False, "chat_local")
    return Verdict(True)


__all__ = [
    "ChatPrivacy",
    "MemoryPrivacy",
    "Reason",
    "Target",
    "Verdict",
    "chat_is_local",
    "effective_privacy",
    "may_use",
    "memory_is_local",
]
