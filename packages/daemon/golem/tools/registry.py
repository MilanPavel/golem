"""Named tools, their argument models, and one way to call them.

A tool takes a Pydantic model of its arguments and a :class:`ToolContext`,
and returns a :class:`ToolResult`. A failure the model should read is a
:class:`ToolError`. The graph turns the registry into provider tool schemas
and calls :meth:`ToolRegistry.call`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Literal, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from golem.config import PERMISSION_MODES, PermissionMode, ShellSettings, WebSettings
from golem.data.sources import DataAccess
from golem.memory.privacy import Target
from golem.memory.service import MemoryAccess
from golem.skills.registry import SkillView

MAX_OUTPUT_CHARS = 5_000_000
"""What one call may return, at most. Output this big goes to an artifact, not the model."""


class ToolError(Exception):
    """A tool call that did not work. The message goes to the model as the result."""


class InvalidArguments(ToolError):
    """The model's arguments do not fit the tool's schema."""


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
    of ``session_id``. ``read_roots`` are the folders of the skills the
    session ran: the read tools may read them, and nothing writes there.
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
    read_roots: tuple[Path, ...] = ()
    enable_mcp: Callable[[str], Awaitable[list[str]]] | None = None
    """Turns on an on-demand MCP server for the session. Returns its tool names."""
    skills: SkillView | None = None
    """The skills the session's folder sees, for ``load_skill``."""
    page_chars: int | None = None
    """The most characters of a result page for the model's window, for ``read_artifact``."""
    memory: MemoryAccess | None = None
    """What the run may use of memory, for ``recall`` and ``remember``. None: memory is off."""
    memory_target: Target | None = None
    """The model of this call, for the privacy check of ``recall``."""
    data: DataAccess | None = None
    """The data sources of the session's folder, for the ``data_*`` tools. None: not available."""


@dataclass(frozen=True, slots=True)
class FileEdit:
    """One file a call wrote. ``before`` is None for a new file, ``after`` for a deleted one."""

    path: str  # relative to the session folder
    before: str | None
    after: str | None
    source: Literal["tool", "shell"] = "tool"


@dataclass(frozen=True, slots=True)
class Source:
    """A web page a call found or read, for the screen's source chips.

    ``kind`` is ``search`` for a hit in search results and ``read`` for a page that
    was fetched. ``title`` and ``snippet`` are text from the page: data, never sent to the model.
    """

    url: str
    title: str
    snippet: str
    kind: Literal["search", "read"]


@dataclass(frozen=True, slots=True)
class DataRead:
    """Which data source a result read and its level, so a hosted call can swap the result.

    ``hosted`` is what a model that may not read the rows gets in place of ``output``: no
    values. None when ``output`` already holds none.
    """

    source: str
    privacy: str
    hosted: str | None = None


@dataclass(frozen=True, slots=True)
class TableRead:
    """A query result a ``data_query`` call kept in a file, for the screen's table.

    ``rows`` is the first page, as cells the wire can carry. ``total_rows`` is how many rows
    the file holds. The model never gets this: it is for the user's client.
    """

    result_id: str
    source: str
    sql: str
    columns: list[dict[str, str]]
    rows: list[list[Any]]
    total_rows: int
    truncated: bool


@dataclass(frozen=True, slots=True)
class ToolResult:
    """``output`` goes to the model. ``summary`` is one short line for the screen.

    ``update`` is graph state the call changes, such as ``todos``. The tools
    node applies only the keys it knows, so a tool never reaches the rest.
    ``failed`` says the call ran but did not succeed, such as a command that
    exited non-zero. The screen marks it, and the model gets the output as usual.

    ``diff`` is what the call changed, as a unified diff, for the screen. Not
    sent to the model. ``edits`` are the files the call wrote, whole texts, for the
    tools node to report. They never reach the wire.

    ``sources`` are the web pages the call found or read, for the screen. Not sent to the model.
    ``memory_ids`` are the memories a ``recall`` result shows, one line each in this order, so a
    later call can tell which of them it may send. None for any other tool.

    ``data`` says which data source a ``data_*`` result read. ``shown`` is what the screen
    gets in place of ``output`` when the two differ, and ``rows_withheld`` says the model of
    this call did not get the rows the screen shows. ``table`` is the kept result of a
    ``data_query``, for the screen's table.
    """

    output: str
    summary: str
    update: Mapping[str, object] | None = None
    failed: bool = False
    diff: str | None = None
    edits: tuple[FileEdit, ...] = ()
    sources: tuple[Source, ...] = ()
    memory_ids: tuple[str, ...] | None = None
    data: DataRead | None = None
    shown: str | None = None
    rows_withheld: bool = False
    table: TableRead | None = None


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

    ``allow_from`` is the most careful permission mode whose built-in rules
    allow the tool without asking, null for a tool no mode allows. With
    ``offline_only`` the mode allows it only while ``[shell] network`` is off.
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
    allow_from: PermissionMode | None = None
    offline_only: bool = False
    plan_only: bool = False
    """Offered only while the session is in plan first, such as ``propose_plan``."""
    needs_memory: bool = False
    """Offered only to a run that carries memory, such as ``recall``."""

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
            raise InvalidArguments(f"invalid arguments for {self.name}: {_problems(exc)}") from exc


@dataclass(frozen=True, slots=True)
class ToolScope:
    """Which outside tools one session sees.

    ``root`` is its folder, which may bring a trusted project's MCP servers,
    and ``enabled`` the on-demand servers it turned on with ``/mcp enable``. With ``only``
    the scope has exactly those of golem's own tools and no outside ones, as a helper's does.
    ``memory`` says the run carries memory, so it sees the tools that need it.
    """

    root: Path | None = None
    enabled: frozenset[str] = frozenset()
    only: frozenset[str] | None = None
    memory: bool = False


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
        self._all_schemas = [tool.schema() for tool in self._tools.values() if not tool.plan_only]
        self._plain_schemas = [
            tool.schema()
            for tool in self._tools.values()
            if not tool.plan_only and not tool.needs_memory
        ]
        # Offered without a scope: no run, so no memory, so no memory tools.
        self._schemas = self._plain_schemas
        self._extra: dict[str, Tool[Any]] = {}
        self.delegate_text: Callable[[Path | None], str] | None = None
        """The description of ``delegate`` for a session folder, with the agent types it sees.
        The session manager sets it. None: ``delegate`` keeps its own description."""
        self.delegate_hidden: Callable[[], bool] | None = None
        """Whether ``delegate`` is left out of a session's tools now (``[agents] use_helpers =
        "never"``). Read at each :meth:`scoped`, so a change applies to the next message."""

    def scoped(self, scope: ToolScope) -> ToolRegistry:
        """This registry with the outside tools ``scope`` sees."""
        view = ToolRegistry.__new__(ToolRegistry)
        if scope.only is not None:
            view._tools = {n: t for n, t in self._tools.items() if n in scope.only}
            view._source = None
            view._schemas = [t.schema() for t in view._tools.values() if not t.plan_only]
            view._plain_schemas = view._all_schemas = view._schemas
            view._extra = {}
            view.delegate_text = None
            view.delegate_hidden = None
            return view
        view._source, view._plain_schemas = self._source, self._plain_schemas
        view._all_schemas = self._all_schemas
        if scope.memory:
            view._tools, view._schemas = self._tools, self._all_schemas
        else:
            view._tools = {n: t for n, t in self._tools.items() if not t.needs_memory}
            view._schemas = self._plain_schemas
        found: Iterable[Tool[Any]] = () if self._source is None else self._source.tools(scope)
        view._extra = {tool.name: tool for tool in found if tool.name not in self._tools}
        view.delegate_text = self.delegate_text
        view.delegate_hidden = self.delegate_hidden
        if self.delegate_hidden is not None and self.delegate_hidden():
            view._tools = {n: t for n, t in view._tools.items() if n != "delegate"}
            view._schemas = [i for i in view._schemas if _function_name(i) != "delegate"]
        self._describe_delegate(view, scope.root)
        return view

    def _describe_delegate(self, view: ToolRegistry, root: Path | None) -> None:
        """Give ``delegate`` in ``view`` the agent types ``root`` sees."""
        tool = view._tools.get("delegate")
        if tool is None or self.delegate_text is None:
            return
        described = replace(tool, description=self.delegate_text(root))
        view._tools = {**view._tools, "delegate": described}
        view._schemas = [
            described.schema() if _function_name(item) == "delegate" else item
            for item in view._schemas
        ]

    async def prepare(self, scope: ToolScope) -> None:
        if self._source is not None and scope.only is None:
            await self._source.prepare(scope)

    @property
    def names(self) -> list[str]:
        return [*self._tools, *self._extra]

    def get(self, name: str) -> Tool[Any] | None:
        return self._tools.get(name) or self._extra.get(name)

    def default_allowed(
        self, mode: PermissionMode = "careful", *, network: bool = False
    ) -> list[str]:
        """Tools the built-in rules allow without asking in ``mode``.

        Read-only and internal tools in every mode. A tool with ``allow_from`` joins
        them from that mode on, and one that is ``offline_only`` only when ``network``
        (``[shell] network``) is false.
        """
        rank = PERMISSION_MODES.index(mode)
        tools = [*self._tools.values(), *self._extra.values()]
        return [
            tool.name
            for tool in tools
            if tool.read_only
            or tool.internal
            or (
                tool.allow_from is not None
                and PERMISSION_MODES.index(tool.allow_from) <= rank
                and not (tool.offline_only and network)
            )
        ]

    def schemas(self, *, plan_first: bool = False) -> list[dict[str, object]]:
        """The tool schemas for a model call.

        In plan first: golem's read-only and internal tools, and ``propose_plan``. Outside
        tools are left out. Otherwise ``propose_plan`` is.
        """
        if plan_first:
            return [tool.schema() for tool in self._tools.values() if self.plan_allows(tool.name)]
        return [*self._schemas, *(tool.schema() for tool in self._extra.values())]

    def plan_allows(self, name: str) -> bool:
        """Whether a plan first run may call ``name``: a read-only or internal tool of golem's."""
        tool = self._tools.get(name)
        return tool is not None and (tool.read_only or tool.internal)

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
            return replace(result, output=f"{cut}\n[output cut at {MAX_OUTPUT_CHARS} characters]")
        return result

    def _tool(self, name: str) -> Tool[Any]:
        tool = self.get(name)
        if tool is None:
            raise ToolError(f"unknown tool {name!r}; the tools are {', '.join(self.names)}")
        return tool


def _function_name(schema: Mapping[str, object]) -> object:
    function = schema.get("function")
    return function.get("name") if isinstance(function, dict) else None  # type: ignore[reportUnknownMemberType]


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
    "DataRead",
    "InvalidArguments",
    "Network",
    "Preview",
    "TableRead",
    "Tool",
    "ToolContext",
    "ToolError",
    "ToolRegistry",
    "ToolResult",
    "ToolScope",
    "ToolSource",
]
