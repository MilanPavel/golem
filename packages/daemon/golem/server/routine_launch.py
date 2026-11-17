"""How a routine firing starts a session: the daemon side of the scheduler's launcher."""

from __future__ import annotations

import re
from pathlib import Path

from golem.mcp import McpSupervisor
from golem.routine_scheduler import Planned
from golem.server.mcp_model import turn_on
from golem.sessions.manager import SessionManager
from golem_protocol.events import SkillCall

_SKILL = re.compile(r"^/(\S+)(?:\s+(.*))?$", re.DOTALL)


def skill_of(prompt: str) -> SkillCall | None:
    """The skill call of a ``/skill args`` prompt, as the composer reads it. None for plain text."""
    found = _SKILL.match(prompt.strip())
    if found is None:
        return None
    return SkillCall(name=found.group(1), args=(found.group(2) or "").strip())


def folder_of(routine: Planned) -> str | None:
    """The folder a routine runs in. A project routine with none runs in the project."""
    given = routine.settings.folder
    if given is None:
        return None if routine.folder is None else str(routine.folder)
    path = Path(given).expanduser()
    if not path.is_absolute() and routine.folder is not None:
        path = routine.folder / path
    return str(path)


class SessionLauncher:
    """Starts a routine's session with the session manager, and sends its prompt."""

    def __init__(self, sessions: SessionManager, mcp: McpSupervisor | None) -> None:
        self._sessions = sessions
        self._mcp = mcp

    async def create(self, routine: Planned) -> str:
        settings = routine.settings
        session_id = await self._sessions.create(
            settings.model, cwd=folder_of(routine), origin=f"routine:{settings.name}"
        )
        if settings.mcp:
            scope = await self._sessions.tool_scope(session_id)
            for server in settings.mcp:
                if self._mcp is None:
                    await self._sessions.set_mcp(session_id, server, True)
                else:
                    await turn_on(self._sessions, self._mcp, session_id, scope, server)
        return session_id

    async def send(self, routine: Planned, session_id: str) -> None:
        prompt = routine.settings.prompt
        await self._sessions.send(session_id, prompt, skill=skill_of(prompt))
