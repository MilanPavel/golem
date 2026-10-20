"""Named tools, their argument models, and one way to call them.

A tool takes a Pydantic model of its arguments and a :class:`ToolContext`,
and returns a :class:`ToolResult`. A failure the model should read is a
:class:`ToolError`. The graph turns the registry into provider tool schemas
and calls :meth:`ToolRegistry.call`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from golem.config import ShellSettings

MAX_OUTPUT_CHARS = 100_000
"""What the model receives from one call, at most."""


class ToolError(Exception):
    """A tool call that did not work. The message goes to the model as the result."""


@dataclass(frozen=True, slots=True)
class ToolContext:
    """What a call may touch. ``root`` is the session folder, or None without one.

    ``output`` streams text to the screen while the call runs. ``shell`` is the
    user's ``[shell]`` settings.

    ``planned`` holds the text files will have once the earlier calls of the
    same reply have run, so a preview builds on them. ``approved_diff`` is the
    diff the user approved for this call: a file tool applies its change only
    when it still makes exactly that diff.
    """

    root: Path | None
    output: Callable[[str], None] | None = None
    shell: ShellSettings = field(default_factory=ShellSettings)
    planned: Mapping[Path, str] = field(default_factory=dict[Path, str])
    approved_diff: str | None = None


@dataclass(frozen=True, slots=True)
class ToolResult:
    """``output`` goes to the model. ``summary`` is one short line for the screen."""

    output: str
    summary: str


@dataclass(frozen=True, slots=True)
class Preview:
    """What a call would change, worked out without changing anything.

    ``diff`` is what the user is shown. ``path`` will hold ``after``.
    """

    diff: str
    path: Path
    after: str


@dataclass(frozen=True, slots=True)
class Tool[A: BaseModel]:
    """``read_only`` tools change nothing outside golem, so the default policy allows them.

    ``path_arg`` names the argument a rule's ``path`` is matched against, and
    ``match_arg`` the one its ``match`` is. ``subject`` computes the subject
    from the raw arguments and the session folder instead, for tools whose
    subject is not one argument as it is. ``preview`` works out what a call
    would change, so the user can see it before approving the call.
    """

    name: str
    description: str
    args: type[A]
    run: Callable[[A, ToolContext], Awaitable[ToolResult]]
    read_only: bool = False
    path_arg: str | None = None
    match_arg: str | None = None
    subject: Callable[[Mapping[str, object], Path | None], str | None] | None = None
    preview: Callable[[A, ToolContext], Awaitable[Preview]] | None = None

    def schema(self) -> dict[str, object]:
        """The OpenAI function format, which every chat model's ``bind_tools`` accepts."""
        parameters = self.args.model_json_schema()
        parameters.pop("title", None)
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": parameters,
            },
        }

    async def call(self, raw: Mapping[str, object], ctx: ToolContext) -> ToolResult:
        return await self.run(self.validate(raw), ctx)

    async def preview_call(self, raw: Mapping[str, object], ctx: ToolContext) -> Preview | None:
        """What the call would change, or None for a tool without a preview."""
        if self.preview is None:
            return None
        return await self.preview(self.validate(raw), ctx)

    def validate(self, raw: Mapping[str, object]) -> A:
        """The arguments as the tool's model. Raises :class:`ToolError`."""
        try:
            return self.args.model_validate(dict(raw))
        except ValidationError as exc:
            raise ToolError(f"invalid arguments for {self.name}: {_problems(exc)}") from exc


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool[Any]]) -> None:
        self._tools = {tool.name: tool for tool in tools}

    @property
    def names(self) -> list[str]:
        return list(self._tools)

    def get(self, name: str) -> Tool[Any] | None:
        return self._tools.get(name)

    def read_only(self) -> list[str]:
        return [tool.name for tool in self._tools.values() if tool.read_only]

    def schemas(self) -> list[dict[str, object]]:
        return [tool.schema() for tool in self._tools.values()]

    async def preview(
        self, name: str, raw: Mapping[str, object], ctx: ToolContext
    ) -> Preview | None:
        """What tool ``name`` would change with ``raw``. Raises :class:`ToolError`."""
        return await self._tool(name).preview_call(raw, ctx)

    def validate(self, name: str, raw: Mapping[str, object]) -> None:
        """Raises :class:`ToolError` when ``raw`` are not valid arguments for ``name``."""
        self._tool(name).validate(raw)

    async def call(self, name: str, raw: Mapping[str, object], ctx: ToolContext) -> ToolResult:
        """Validate ``raw`` and run tool ``name``. Raises :class:`ToolError`."""
        result = await self._tool(name).call(raw, ctx)
        if len(result.output) > MAX_OUTPUT_CHARS:
            cut = result.output[:MAX_OUTPUT_CHARS]
            return ToolResult(
                output=f"{cut}\n[output cut at {MAX_OUTPUT_CHARS} characters]",
                summary=result.summary,
            )
        return result

    def _tool(self, name: str) -> Tool[Any]:
        tool = self._tools.get(name)
        if tool is None:
            raise ToolError(f"unknown tool {name!r}; the tools are {', '.join(self._tools)}")
        return tool


def _problems(exc: ValidationError) -> str:
    parts: list[str] = []
    for error in exc.errors():
        where = ".".join(str(part) for part in error["loc"]) or "arguments"
        parts.append(f"{where}: {error['msg']}")
    return "; ".join(parts)


__all__ = [
    "MAX_OUTPUT_CHARS",
    "Preview",
    "Tool",
    "ToolContext",
    "ToolError",
    "ToolRegistry",
    "ToolResult",
]
