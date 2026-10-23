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
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from golem.config import ShellSettings, WebSettings

MAX_OUTPUT_CHARS = 5_000_000
"""What one call may return, at most. Output this big goes to an artifact, not the model."""


class ToolError(Exception):
    """A tool call that did not work. The message goes to the model as the result."""


@dataclass(frozen=True, slots=True)
class ArtifactPage:
    """``text`` starts at character ``offset`` of an artifact ``size`` characters long.

    ``kind`` is ``untrusted`` for outside content, such as a web page.
    """

    text: str
    offset: int
    size: int
    kind: str = "tool_output"


@dataclass(frozen=True, slots=True)
class Network:
    """How a web tool reaches the network. Tests replace the transport and the resolver.

    ``resolve`` returns the addresses a host name resolves to.
    """

    transport: httpx.AsyncBaseTransport | None = None
    resolve: Callable[[str], Awaitable[list[str]]] | None = None


class Artifacts(Protocol):
    """Where big output is kept, read one session at a time."""

    async def put(self, session_id: str, call_id: str | None, kind: str, text: str) -> str: ...

    async def read(
        self, session_id: str, artifact_id: str, offset: int, limit: int
    ) -> ArtifactPage | None: ...


@dataclass(frozen=True, slots=True)
class ToolContext:
    """What a call may touch. ``root`` is the session folder, or None without one.

    ``output`` streams text to the screen while the call runs. ``shell`` and
    ``web`` are the user's ``[shell]`` and ``[web]`` settings.

    ``planned`` holds the text files will have once the earlier calls of the
    same reply have run, so a preview builds on them. ``approved_diff`` is the
    diff the user approved for this call: a file tool applies its change only
    when it still makes exactly that diff. ``artifacts`` holds the big output
    of ``session_id``.
    """

    root: Path | None
    output: Callable[[str], None] | None = None
    shell: ShellSettings = field(default_factory=ShellSettings)
    web: WebSettings = field(default_factory=WebSettings)
    planned: Mapping[Path, str] = field(default_factory=dict[Path, str])
    approved_diff: str | None = None
    session_id: str | None = None
    artifacts: Artifacts | None = None
    network: Network = field(default_factory=Network)


@dataclass(frozen=True, slots=True)
class ToolResult:
    """``output`` goes to the model. ``summary`` is one short line for the screen.

    ``update`` is graph state the call changes, such as ``todos``. The tools
    node applies only the keys it knows, so a tool never reaches the rest.
    """

    output: str
    summary: str
    update: Mapping[str, object] | None = None


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
    ``internal`` tools change only golem's own state, such as the todo list, and
    are allowed by default too. ``untrusted`` tools return outside content, such
    as a web page, so the rest of their output stays marked as data.

    ``path_arg`` names the argument a rule's ``path`` is matched against, and
    ``match_arg`` the one its ``match`` is. ``subject`` computes the subject
    from the raw arguments and the session folder instead, for tools whose
    subject is not one argument as it is. ``preview`` works out what a call
    would change, so the user can see it before approving the call.

    ``parameters`` is the JSON Schema of the arguments when it does not come
    from ``args``, as for an MCP server's tool. ``args`` then only checks
    that the arguments are an object, and the server checks the rest.
    """

    name: str
    description: str
    args: type[A]
    run: Callable[[A, ToolContext], Awaitable[ToolResult]]
    read_only: bool = False
    internal: bool = False
    untrusted: bool = False
    path_arg: str | None = None
    match_arg: str | None = None
    subject: Callable[[Mapping[str, object], Path | None], str | None] | None = None
    preview: Callable[[A, ToolContext], Awaitable[Preview]] | None = None
    parameters: Mapping[str, object] | None = None

    def schema(self) -> dict[str, object]:
        """The OpenAI function format, which every chat model's ``bind_tools`` accepts."""
        if self.parameters is not None:
            parameters = dict(self.parameters)
        else:
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


@dataclass(frozen=True, slots=True)
class ToolScope:
    """Which outside tools one session sees.

    ``root`` is its folder, which may bring a trusted project's MCP servers,
    and ``enabled`` the on-demand servers it turned on with ``/mcp enable``.
    """

    root: Path | None = None
    enabled: frozenset[str] = frozenset()


class ToolSource(Protocol):
    """Tools that come and go, such as MCP servers', by session."""

    def tools(self, scope: ToolScope) -> Iterable[Tool[Any]]:
        """The tools ``scope`` sees right now."""
        ...

    async def prepare(self, scope: ToolScope) -> None:
        """Start what ``scope`` needs, and wait a little for it to be ready."""
        ...


class ToolRegistry:
    """golem's own tools, plus a session's outside tools once :meth:`scoped`.

    The registry built with a ``source`` has only golem's own tools. Each
    model call and each tool call asks :meth:`scoped` for the session's view,
    so a server that started since the last call adds its tools, and a
    session never reaches a server it does not have. A built-in tool keeps
    its name if an outside one has it too.
    """

    def __init__(self, tools: Iterable[Tool[Any]], source: ToolSource | None = None) -> None:
        self._tools = {tool.name: tool for tool in tools}
        self._source = source
        self._schemas = [tool.schema() for tool in self._tools.values()]
        self._extra: dict[str, Tool[Any]] = {}

    def scoped(self, scope: ToolScope) -> ToolRegistry:
        """This registry with the outside tools ``scope`` sees."""
        view = ToolRegistry.__new__(ToolRegistry)
        view._tools, view._source, view._schemas = self._tools, self._source, self._schemas
        found: Iterable[Tool[Any]] = () if self._source is None else self._source.tools(scope)
        view._extra = {tool.name: tool for tool in found if tool.name not in self._tools}
        return view

    async def prepare(self, scope: ToolScope) -> None:
        if self._source is not None:
            await self._source.prepare(scope)

    @property
    def names(self) -> list[str]:
        return [*self._tools, *self._extra]

    def get(self, name: str) -> Tool[Any] | None:
        return self._tools.get(name) or self._extra.get(name)

    def default_allowed(self) -> list[str]:
        """Tools the built-in rules allow without asking: read-only or internal ones."""
        tools = [*self._tools.values(), *self._extra.values()]
        return [tool.name for tool in tools if tool.read_only or tool.internal]

    def schemas(self) -> list[dict[str, object]]:
        return [*self._schemas, *(tool.schema() for tool in self._extra.values())]

    async def preview(
        self, name: str, raw: Mapping[str, object], ctx: ToolContext
    ) -> Preview | None:
        """What tool ``name`` would change with ``raw``. Raises :class:`ToolError`."""
        return await self._tool(name).preview_call(raw, ctx)

    def validate(self, name: str, raw: Mapping[str, object]) -> dict[str, object]:
        """``raw`` as tool ``name`` reads them. Raises :class:`ToolError` when invalid."""
        return self._tool(name).validate(raw).model_dump(mode="json", exclude_unset=True)

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
        tool = self.get(name)
        if tool is None:
            raise ToolError(f"unknown tool {name!r}; the tools are {', '.join(self.names)}")
        return tool


def _problems(exc: ValidationError) -> str:
    parts: list[str] = []
    for error in exc.errors():
        where = ".".join(str(part) for part in error["loc"]) or "arguments"
        parts.append(f"{where}: {error['msg']}")
    return "; ".join(parts)


__all__ = [
    "MAX_OUTPUT_CHARS",
    "ArtifactPage",
    "Artifacts",
    "Network",
    "Preview",
    "Tool",
    "ToolContext",
    "ToolError",
    "ToolRegistry",
    "ToolResult",
    "ToolScope",
    "ToolSource",
]
