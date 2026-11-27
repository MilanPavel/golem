"""The seam between a workflow's ``run.tool`` and golem's tools (ADR-062, ADR-012).

This is the only workflow code that touches the tool registry, the MCP tools and the permission
engine. The decision is the chat's: :meth:`Policy.check` with the same rules, so a workflow is
allowed, denied or asked exactly when a chat would be.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from golem.data.sources import DataSources
from golem.permissions.policy import Policy, explain
from golem.tools.registry import Artifacts, ToolContext, ToolError, ToolRegistry, ToolScope
from golem.workflow import WorkflowError, idempotency_key

KEY_ARG = "idempotency_key"
"""A tool that takes this argument gets the step's key in it, when the workflow left it out."""

SESSION_TOOLS = frozenset({"read_artifact", "remember", "load_skill"})
"""The tools that read the session they run in. A run makes its session before it calls one."""

_WRAPPED = re.compile(r"\A.*?\n<mcp_output[^>\n]*>\n(.*)\n</mcp_output>\Z", re.DOTALL)


@dataclass(frozen=True, slots=True)
class ToolVerdict:
    """What the rules say about one call. ``reason`` names the rule, for ``deny`` and ``ask``."""

    action: Literal["allow", "deny", "ask"]
    reason: str = ""
    source: str = ""


class WorkflowTools:
    def __init__(
        self,
        *,
        registry: ToolRegistry,
        policy: Policy,
        artifacts: Artifacts | None = None,
        data: DataSources | None = None,
    ) -> None:
        self._registry = registry
        self._policy = policy
        self._artifacts = artifacts
        self._data = data

    async def _view(self, cwd: str | None) -> tuple[ToolRegistry, Path | None]:
        root = None if cwd is None else Path(cwd)
        scope = ToolScope(root=root)
        await self._registry.prepare(scope)
        return self._registry.scoped(scope), root

    async def decide(self, cwd: str | None, name: str, args: Mapping[str, object]) -> ToolVerdict:
        """Allow, deny or ask for ``name`` with ``args`` in the run's folder.

        Raises :class:`WorkflowError` for a tool that does not exist or arguments that do not fit.
        """
        view, root = await self._view(cwd)
        if view.get(name) is None:
            raise WorkflowError(f"unknown tool {name!r}; the tools are {', '.join(view.names)}")
        try:
            view.validate(name, args)
        except ToolError as exc:
            raise WorkflowError(f"{name}: {exc}") from exc
        decision = self._policy.check(view, name, args, root)
        if decision.allowed:
            return ToolVerdict("allow", source=decision.source)
        action: Literal["deny", "ask"] = "deny" if decision.action == "deny" else "ask"
        return ToolVerdict(action, explain(decision, name), decision.source)

    async def call(
        self, session_id: str | None, cwd: str | None, name: str, args: Mapping[str, object]
    ) -> str:
        """Run the tool and return its output as text. Raises :class:`WorkflowError`."""
        view, root = await self._view(cwd)
        tool = view.get(name)
        if tool is None:
            raise WorkflowError(f"unknown tool {name!r}")
        given = dict(args)
        key = idempotency_key()
        if key is not None and KEY_ARG not in given and _takes_key(tool.schema()):
            given[KEY_ARG] = key
        ctx = ToolContext(
            root=root,
            shell=self._policy.shell(),
            web=self._policy.web(),
            session_id=session_id,
            artifacts=self._artifacts,
            data=None if self._data is None else self._data.access(root),
        )
        try:
            result = await view.call(name, given, ctx)
        except ToolError as exc:
            raise WorkflowError(f"{name}: {exc}") from exc
        if result.failed:
            raise WorkflowError(f"{name} failed: {result.output[:500]}")
        # No model reads this: a script gets the rows of any source, as the user does.
        output = result.output if result.shown is None else result.shown
        return _bare(output) if tool.untrusted else output

    async def keep(self, session_id: str, key: str, text: str) -> str:
        """Store big output as an artifact of the run's session and return its id."""
        if self._artifacts is None:
            raise WorkflowError("this daemon keeps no artifacts")
        return await self._artifacts.put(session_id, f"wf:{key}", "tool_output", text)

    async def load(self, session_id: str, artifact_id: str, size: int) -> str:
        """The whole text of an artifact :meth:`keep` stored."""
        page = None
        if self._artifacts is not None:
            page = await self._artifacts.read(session_id, artifact_id, 0, size)
        if page is None:
            raise WorkflowError(f"artifact {artifact_id} of this run's tool output is gone")
        return page.text


def _takes_key(schema: Mapping[str, Any]) -> bool:
    function = schema.get("function")
    parameters = function.get("parameters") if isinstance(function, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    properties = parameters.get("properties") if isinstance(parameters, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return isinstance(properties, dict) and KEY_ARG in properties


def _bare(output: str) -> str:
    """An MCP tool's output without the data note and wrapper the model reads it in."""
    found = _WRAPPED.match(output)
    return output if found is None else found.group(1)


__all__ = ["KEY_ARG", "SESSION_TOOLS", "ToolVerdict", "WorkflowTools"]
