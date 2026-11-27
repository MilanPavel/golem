"""Unix-socket server. Owns the pid lock, the socket, and shutdown."""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import logging
import os
import signal
import sys
import time
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping
from pathlib import Path

from pydantic import BaseModel

from golem.agents.bundled import bundled_agents_dir
from golem.agents.registry import AgentRegistry
from golem.coding.changes import ChangeStore
from golem.config import DelegateSettings, MemorySettings, ModelPrice, load_settings
from golem.data.client import DataWorker
from golem.data.section import data_section
from golem.data.sources import DataSources
from golem.evals.job import EvalJobs, EvalParts
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.cite_prompt import CITE_PROMPT
from golem.graphs.delegate_policy import Prices
from golem.graphs.delegate_prompt import delegate_prompt, prices_of
from golem.graphs.estimate import TokenRatios
from golem.graphs.instructions_prompt import instructions_section
from golem.graphs.prompt import PLAN, SystemPrompt
from golem.graphs.summarise import Summariser
from golem.lock import DaemonAlreadyRunning, DaemonLock
from golem.logging import configure_logging
from golem.mcp import McpSupervisor
from golem.mcp.prompt import mcp_section
from golem.memory.section import memory_section
from golem.memory.service import MemoryChange, MemoryService
from golem.memory.store import MemoryStore
from golem.models.bench_manager import BenchManager
from golem.models.bench_store import BenchStore
from golem.models.budget import Budget
from golem.models.check import CheckManager
from golem.models.discovery import Loaded, ModelDiscovery
from golem.models.dispatcher import Call
from golem.models.dispatcher import Dispatcher as ModelDispatcher
from golem.models.facts import FactsSource, ListedFacts
from golem.models.huggingface import HuggingFace
from golem.models.install import RUNTIMES, OllamaInstaller, runtime_installer
from golem.models.keys import ProviderKeys
from golem.models.ollama import LocalServer, LocalServers, ServerState
from golem.models.ollama_library import OllamaLibrary
from golem.models.pulls import PullManager
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.scores import Scores
from golem.models.speed import SpeedBook
from golem.models.tiers import Tier, blended
from golem.models.window import resolve_window
from golem.models.window_plans import WindowPlans
from golem.notify import Notifier, NotifierKinds, Poster, SessionFacts, default_poster
from golem.pairing import PairingManager
from golem.paths import GolemPaths, resolve_paths
from golem.permissions.policy import Policy
from golem.routine_scheduler import RoutineScheduler
from golem.routine_watcher import FileWatcher
from golem.secrets import KeychainSecrets, SecretStore
from golem.server.connection import ClientConnection
from golem.server.dispatcher import (
    PARSE_ERROR,
    Dispatcher,
    Method,
    send_failure,
)
from golem.server.framing import MAX_LINE_BYTES, FrameTooLong, read_frame
from golem.server.handlers import standard_methods
from golem.server.mcp_model import turn_on_for_model
from golem.server.routine_launch import SessionLauncher
from golem.server.routing_edit import local_model_in_use
from golem.server.start_error import (
    clear_start_error,
    describe_database_too_new,
    describe_lock_held,
    describe_socket_path_too_long,
    write_start_error,
)
from golem.server.state import DaemonState
from golem.sessions.agent_usage import AgentUsage
from golem.sessions.bus import EventBus
from golem.sessions.drafts import ModelDrafts
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import recover_runs, sweep_copies
from golem.sessions.suggestions import ChatSuggestions
from golem.sessions.titles import ModelTitles, TitleGenerator
from golem.sessions.trim import HelperTrimmer
from golem.sessions.usage import Usage, backfill
from golem.skills.bundled import bundled_skills_dir
from golem.skills.index import index_section
from golem.skills.pinned import pinned_section
from golem.skills.registry import SkillRegistry
from golem.store.artifacts import ArtifactStore
from golem.store.blobs import BlobStore
from golem.store.checkpoints import open_checkpoints
from golem.store.database import Database, DatabaseTooNewError
from golem.store.devices import DeviceStore
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.store.routine_runs import RoutineRuns
from golem.store.suggestions import SuggestionStore
from golem.store.workflow_runs import WorkflowRuns
from golem.tools import default_registry
from golem.tools.registry import ToolRegistry, ToolScope
from golem.workflows.agents import WorkflowAgents
from golem.workflows.check import CheckEnv
from golem.workflows.llm import WorkflowLlm, named_model_problem
from golem.workflows.service import WorkflowService
from golem.workflows.tools import WorkflowTools
from golem_protocol.commands import (
    AgentRegistryChanged,
    DataChanged,
    KeychainWait,
    MemoryChanged,
    ModelServerStatus,
)
from golem_protocol.rpc import (
    AgentRegistryChangedNotification,
    DataChangedNotification,
    DeviceChangedNotification,
    KeychainWaitNotification,
    MemoryChangedNotification,
    ModelServerStatusNotification,
)

log = logging.getLogger("golem.server")

MAX_CONNECTIONS = 32
FLUSH_TIMEOUT_SECONDS = 1.0
# sockaddr_un.sun_path is 104 bytes on macOS, including the trailing NUL.
_MAX_SOCKET_BYTES = 103
_IDLE_CHECK_SECONDS = 60.0
# How often the daemon checks that its socket file is still the one it bound.
SOCKET_CHECK_SECONDS = 5.0


class SocketPathTooLong(Exception):
    """The socket path does not fit in a Unix socket address."""

    def __init__(self, path: Path) -> None:
        self.path = path
        super().__init__(f"socket path is too long for a Unix socket: {path}")


def assert_socket_path_fits(path: Path) -> None:
    if len(os.fsencode(path)) > _MAX_SOCKET_BYTES:
        raise SocketPathTooLong(path)


def _delegate_now(home: Path) -> DelegateSettings:
    """``[agents.delegate]`` as ``config.toml`` has it now; the defaults when it does not load."""
    try:
        return load_settings(home=home, project_dir=home).agents.delegate
    except (OSError, ValueError):
        return DelegateSettings()


class DaemonApp:
    """Accepts clients, dispatches commands, and drains tasks on shutdown."""

    def __init__(
        self,
        paths: GolemPaths,
        *,
        extra_methods: Mapping[str, Method] | None = None,
        max_connections: int = MAX_CONNECTIONS,
        router: ModelRouter | None = None,
        titles: TitleGenerator | None = None,
        discovery: Callable[[ModelRouter], ModelDiscovery] | None = None,
        facts: FactsSource | None = None,
        pulls: Callable[[ModelRouter, float | None], PullManager] | None = None,
        mcp: McpSupervisor | None = None,
        secrets: SecretStore | None = None,
        user_home: Path | None = None,
        bundled_skills: Path | None = None,
        bundled_agents: Path | None = None,
        local_servers: LocalServers | None = None,
        socket_check_seconds: float = SOCKET_CHECK_SECONDS,
        poster: Poster | None = None,
        evals: EvalParts | None = None,
    ) -> None:
        self.paths = paths
        self._eval_parts = evals
        self._socket_check_seconds = socket_check_seconds
        self._socket_inode: int | None = None
        self._user_home = user_home
        self._bundled_skills = bundled_skills
        self._bundled_agents = bundled_agents
        self._router = router
        self._titles = titles
        self._discovery = discovery
        self._facts = facts
        self._pulls = pulls
        self._mcp = mcp
        self._local = local_servers
        self._poster = poster
        self.state = DaemonState(
            paths=paths, started_at=time.monotonic(), secrets=secrets, user_home=user_home
        )
        self.state.broadcast = self._broadcast
        self.state.broadcast_owner = self._broadcast_owner
        methods = standard_methods()
        if extra_methods:
            methods.update(extra_methods)
        self._dispatcher = Dispatcher(methods)
        self._max_connections = max_connections
        self._lock = DaemonLock(paths)
        self._server: asyncio.Server | None = None
        self._clients: set[asyncio.Task[None]] = set()
        self._closers: set[asyncio.Task[None]] = set()
        self._connections: set[ClientConnection] = set()
        self._stop = asyncio.Event()
        self._draining = False
        self._trimmer: HelperTrimmer | None = None

    def request_shutdown(self) -> None:
        """Ask :meth:`serve` to stop. Safe to call from a signal handler."""
        if self._stop.is_set():
            return
        self.state.state = "draining"
        self._draining = True
        self._stop.set()

    async def serve(self, *, install_signals: bool = True) -> None:
        """Bind the socket and run until :meth:`request_shutdown`.

        When the pid lock is free, a leftover socket file is removed before
        the bind. SIGTERM and SIGINT drain in-flight handlers, then unlink
        the socket and release the lock.
        """
        assert_socket_path_fits(self.paths.socket_path)
        self._lock.acquire()
        loop = asyncio.get_running_loop()
        installed: list[signal.Signals] = []
        keychain = self.state.secrets if isinstance(self.state.secrets, KeychainSecrets) else None
        if keychain is not None:
            keychain.on_wait = lambda name, waiting: self._from_thread(
                loop, self._keychain_waited, name, waiting
            )
        try:
            settings = load_settings(home=self.paths.home, project_dir=self.paths.home)
            router = self._router or ModelRouter(settings, home=self.paths.home)
            policy = Policy(self.paths.config_file)
            mcp = self._mcp or McpSupervisor(
                settings.mcp,
                user_config=self.paths.config_file,
                trusted=policy.trusted,
                secrets=self._secret,
                store=self.state.secrets,
            )
            mcp.broadcast = self._broadcast
            policy.mcp_allowed = mcp.allowed_servers
            policy.mcp_read_only = mcp.read_only_tools
            self.state.mcp = mcp
            local = self._local or LocalServers(
                settings.ollama, log_file=self.paths.ollama_log_file, run_dir=self.paths.run_dir
            )
            local.listener = self._server_changed
            self.state.local_servers = local
            home = self.paths.home
            self.state.skills = SkillRegistry(
                settings.skills,
                golem_skills=self.paths.skills_dir,
                user_home=self._user_home,
                bundled=self._bundled_skills,
                config_file=self.paths.config_file,
                load_settings=lambda: load_settings(home=home, project_dir=home).skills,
                broadcast=self._broadcast,
            )

            def agents_changed(root: Path | None) -> None:
                self._broadcast(
                    AgentRegistryChangedNotification(
                        params=AgentRegistryChanged(root=None if root is None else str(root))
                    )
                )

            self.state.agents = AgentRegistry(
                settings.agents,
                golem_agents=self.paths.agents_dir,
                trusted=policy.trusted,
                user_home=self._user_home,
                bundled=self._bundled_agents,
                config_file=self.paths.config_file,
                load_settings=lambda: load_settings(home=home, project_dir=home).agents,
                on_change=agents_changed,
            )
            if self._discovery is None:
                models = ModelDiscovery(router, self.paths.cache_dir)
            else:
                models = self._discovery(router)
            if isinstance(self._titles, ModelTitles):
                self._titles.bind(models.tier_of_ref, models.budget_refs)
            speeds = SpeedBook(self.paths.cache_dir)
            models.speeds = speeds

            def note_speed(profile: str, timings: Mapping[str, int]) -> None:
                resolved = router.resolve(profile)
                if resolved.provider.kind != "ollama":
                    return
                speeds.note(
                    resolved.ref,
                    prompt_tokens=timings.get("prompt_tokens"),
                    prompt_ms=timings.get("prompt_ms"),
                    reply_tokens=timings.get("reply_tokens"),
                    reply_ms=timings.get("reply_ms"),
                    load_ms=timings.get("load_ms"),
                )

            bench_store = BenchStore(self.paths.cache_dir, ram_gb=models.ram_gb)
            router.plans = WindowPlans(
                settings=router.context_settings,
                discovery=models,
                ram_gb=models.ram_gb,
                cache_dir=self.paths.cache_dir,
                parallel=lambda: local.settings.parallel,
                measured=bench_store.measured,
            )

            async def note_loaded(profile: str, sent_num_ctx: int | None) -> Loaded:
                resolved = router.resolve(profile)
                if resolved.provider.kind != "ollama":
                    return Loaded()
                return await models.note_loaded(resolved.ref, sent_num_ctx)

            async def learn_window(profile: str) -> None:
                resolved = router.resolve(profile)
                if resolved.provider.kind == "ollama":
                    await models.learn(resolved.ref)

            async with (
                Database.open(self.paths.database_file) as database,
                open_checkpoints(database, self.paths.checkpoints_file) as saver,
                _open_memory(self.paths.memory_file, settings.memory, self._broadcast) as memory,
            ):
                self.state.memory = memory
                self.state.policy = policy
                self.state.tools = default_registry(mcp, policy.web())
                data = DataSources(
                    DataWorker(settings.data, self.paths), self.paths, trusted=policy.trusted
                )
                data.changed = lambda name, reason: self._broadcast(
                    DataChangedNotification(
                        params=DataChanged(source=name, reason=reason)  # type: ignore[arg-type]
                    )
                )
                data.secrets = self.state.secrets
                self.state.data = data
                self.state.artifacts = ArtifactStore(database)
                data.results.artifacts = self.state.artifacts
                data.results.start()
                self.state.changes = ChangeStore(database, BlobStore(database))
                usage = Usage(database)
                scores = Scores(database)
                models.scores = scores
                self.state.scores = scores
                replayed = await backfill(database)
                if replayed:
                    log.info("filled model_calls from %d stored model call events", replayed)
                self.state.usage = usage
                self.state.agent_usage = AgentUsage(database)
                budget = Budget(usage, router.budget_settings)
                if isinstance(self._titles, ModelTitles):
                    self._titles.limit(budget.paid_ok)
                    self._titles.record_to(
                        usage,
                        lambda profile: _price_of(router, models, profile),
                        lambda profile: _tier_of(router, models, profile),
                    )
                bus = EventBus()
                state = self.state

                def rank_of(call: Call) -> int:
                    return class_of(call, bus, state.sessions)

                dispatch = ModelDispatcher(rank_of, local_slots=settings.ollama.fixed_parallel)
                if isinstance(self._titles, ModelTitles):
                    self._titles.use(dispatch)
                drafts = ModelDrafts(router, dispatch)
                drafts.bind(models.tier_of_ref, models.budget_refs)
                drafts.limit(budget.paid_ok)
                drafts.record_to(
                    usage,
                    lambda profile: _price_of(router, models, profile),
                    lambda profile: _tier_of(router, models, profile),
                )
                self.state.drafts = drafts
                paths = self.state.paths

                async def chat_lines() -> list[str]:
                    loaded = await asyncio.to_thread(
                        load_settings, home=paths.home, project_dir=paths.home
                    )
                    return list(loaded.chat.instructions)

                self.state.suggestions = ChatSuggestions(
                    drafts, SuggestionStore(database), chat_lines, lambda: state.memory
                )
                chat = open_chat(
                    router,
                    saver,
                    self.state.tools,
                    self.state.policy,
                    self.state.artifacts,
                    local,
                    SystemPrompt(
                        sections=(
                            instructions_section(router),
                            pinned_section(self.state.skills),
                            index_section(self.state.skills),
                            memory_section(),
                            data_section(data),
                            mcp_section(mcp),
                            delegate_prompt(
                                lambda root: (
                                    [] if state.agents is None else state.agents.view(root).usable()
                                ),
                                lambda name: not _is_read_only(self.state.tools, name),
                                lambda: router.agent_settings().delegate,
                            ),
                            CITE_PROMPT,
                            PLAN,
                        )
                    ),
                    BlobStore(database),
                    window_of=lambda profile, overrides: resolve_window(
                        router, profile, models, overrides=overrides
                    ),
                    note_loaded=note_loaded,
                    learn_window=learn_window,
                    context=router.context_settings(),
                    price_of=lambda profile: _price_of(router, models, profile),
                    dispatcher=dispatch,
                    label_of=lambda sid, role: (
                        "a chat" if state.sessions is None else state.sessions.label_of(sid, role)
                    ),
                    tier_of=lambda profile: _tier_of(router, models, profile),
                    helper_prices=lambda profile: _helper_prices(router, models, profile),
                    ratios=TokenRatios(),
                    paid_ok=budget.paid_ok,
                    budget_refs=models.budget_refs,
                    summariser=Summariser(
                        router,
                        dispatcher=dispatch,
                        usage=usage,
                        paid_ok=budget.paid_ok,
                        price_of=lambda profile: _price_of(router, models, profile),
                        tier_of=lambda profile: _tier_of(router, models, profile),
                        budget_refs=models.budget_refs,
                        window_of=lambda profile, overrides: (
                            resolve_window(router, profile, models, overrides=overrides).window
                        ),
                    ),
                )
                self.state.sessions = await _open_sessions(
                    database,
                    bus,
                    chat,
                    self._titles,
                    self.state.skills,
                    BlobStore(database),
                    self.state.agents,
                )
                sessions = self.state.sessions
                sessions.memory = memory
                sessions.golem_home = self.paths.home
                sessions.budget = budget
                self.state.notifier = _open_notifier(
                    SessionRecords(database),
                    bus,
                    self._poster or default_poster(self.paths.home),
                    self.paths.home,
                )
                self.state.routine_runs = RoutineRuns(database)
                wf_llm = WorkflowLlm(
                    router,
                    dispatch,
                    local_only=sessions.local_only,
                    tier_of_profile=lambda profile: _tier_of(router, models, profile),
                    budget_refs=models.budget_refs,
                    price_of=lambda profile: _price_of(router, models, profile),
                    paid_ok=budget.paid_ok,
                    usage=usage,
                )
                self.state.workflows = WorkflowService(
                    runs=WorkflowRuns(database),
                    user_dir=self.paths.workflows_dir,
                    user_file=self.paths.config_file,
                    trusted=policy.trusted,
                    broadcast=self._broadcast,
                    create_session=_workflow_session(sessions),
                    notify=self.state.notifier.tell,
                    touch_session=sessions.touch,
                    tools=WorkflowTools(
                        registry=self.state.tools,
                        policy=policy,
                        artifacts=self.state.artifacts,
                        data=data,
                    ),
                    agents=WorkflowAgents(
                        sessions=sessions,
                        agents=self.state.agents,
                        bus=bus,
                        settings=router.agent_settings,
                        skills=self.state.skills,
                        model_problem=lambda name, folder: named_model_problem(
                            router, name, sessions.local_only(folder)
                        ),
                    ),
                    llm=wf_llm,
                    check_env=CheckEnv(
                        model_problem=lambda name: named_model_problem(router, name),
                        default_model=lambda: router.default,
                        agents=lambda folder: (
                            {}
                            if self.state.agents is None
                            else {
                                a.name: a.wish
                                for a in self.state.agents.view(
                                    Path(folder) if folder else None
                                ).usable()
                            }
                        ),
                        local_only=sessions.local_only,
                        tier_of_wish=lambda wish, local_only: _tier_of(
                            router, models, wf_llm.profile_for(wish, local_only)
                        ),
                    ),
                )
                sessions.review_items = self.state.workflows.pending_items
                devices = DeviceStore(database)
                devices.on_change = self._devices_changed
                self.state.devices = devices
                self.state.pairing = PairingManager(
                    devices,
                    lambda: self.state.clock(),
                    self._broadcast_owner,
                    self._devices_changed,
                )
                sessions.devices = devices
                routines = RoutineScheduler(
                    runs=self.state.routine_runs,
                    launcher=SessionLauncher(sessions, mcp),
                    user_file=self.paths.config_file,
                    broadcast=self._broadcast,
                    now=lambda: self.state.clock(),
                    workflows=self.state.workflows,
                )
                self.state.workflows.on_ended = routines.on_workflow_ended
                bus.observe(routines.on_event)
                self.state.routines = routines
                watcher = FileWatcher(routines)
                self.state.watcher = watcher

                async def enable_mcp(session_id: str, scope: ToolScope, name: str) -> list[str]:
                    return await turn_on_for_model(sessions, mcp, session_id, scope, name)

                chat.enable_mcp = enable_mcp
                chat.skills = self.state.skills
                chat.data = data
                chat.changes = self.state.changes
                if self._pulls is None:
                    pulls = PullManager(router, ram_gb=models.ram_gb)
                else:
                    pulls = self._pulls(router, models.ram_gb)
                pulls.broadcast = self._broadcast
                chat.until_pulled = pulls.wait
                pulls.local = local
                models.pulling = pulls.pulling
                models.local = local
                self.state.models = models
                chat.note_speed = note_speed
                self.state.facts = self._facts or ListedFacts(
                    models,
                    router,
                    lambda profile, overrides: resolve_window(
                        router, profile, models, overrides=overrides
                    ),
                    speeds.speed,
                    scores=scores,
                )
                sessions.facts = self.state.facts
                sessions.listed_refs = lambda: [listed.ref for listed in models.cached()]
                sessions.listed_models = models.cached
                self.state.pulls = pulls
                self.state.hf = HuggingFace(transport=pulls.transport, ram_gb=models.ram_gb)
                self.state.ollama_library = OllamaLibrary(
                    transport=pulls.transport, ram_gb=models.ram_gb
                )
                checks = CheckManager(
                    router,
                    scores,
                    tools=default_registry(None, policy.web()),
                    broadcast=self._broadcast,
                    dispatcher=dispatch,
                    local=local,
                    learn_window=learn_window,
                    price_of=lambda profile: _price_of(router, models, profile),
                )
                self.state.checks = checks
                self.state.benches = BenchManager(
                    router, local, broadcast=self._broadcast, store=bench_store
                )
                self.state.evals = EvalJobs(
                    self.paths.evals_dir,
                    delegate=lambda: _delegate_now(self.paths.home),
                    broadcast=self._broadcast,
                    clock=lambda: self.state.clock(),
                    parts=self._eval_parts_with_local(),
                )
                self.state.installer = OllamaInstaller(broadcast=self._broadcast)
                self.state.runtimes = {
                    name: runtime_installer(name, broadcast=self._broadcast) for name in RUNTIMES
                }
                try:
                    if install_signals:
                        installed = _install_signals(loop, self.request_shutdown)
                    self._unlink_socket()
                    self._server = await self._listen()
                    os.chmod(self.paths.socket_path, 0o600)
                    self._socket_inode = self.paths.socket_path.stat().st_ino
                    clear_start_error(self.paths)
                    log.info("listening on %s", self.paths.socket_path)
                    mcp.start()
                    self.state.skills.start()
                    self.state.agents.start()
                    routines.start()
                    self.state.workflows.start()
                    self._trimmer = sessions.helper_trimmer(
                        lambda: load_settings(home=home, project_dir=home).agents,
                        lambda: self.state.clock(),
                        saver.adelete_thread,
                    )
                    self._trimmer.start()
                    watcher.start()
                    self.state.apply_ollama = lambda: _apply_ollama_settings(
                        local, self.paths.home, dispatch
                    )
                    idle = asyncio.create_task(
                        _stop_idle(local, self.paths.home, dispatch), name="golem-ollama-idle"
                    )
                    watch = asyncio.create_task(self._watch_socket(), name="golem-socket-watch")
                    await self._stop.wait()
                    log.info("shutting down")
                    idle.cancel()
                    watch.cancel()
                    await self._shutdown()
                finally:
                    for sig in installed:
                        loop.remove_signal_handler(sig)
                    self._unlink_socket()
        finally:
            if keychain is not None:
                keychain.on_wait = None
            if self.state.mcp is not None:
                await self.state.mcp.aclose()
            self.state.mcp = None
            if self.state.data is not None:
                await self.state.data.close()
            self.state.data = None
            if self.state.skills is not None:
                await self.state.skills.aclose()
            self.state.skills = None
            if self.state.agents is not None:
                await self.state.agents.aclose()
            self.state.agents = None
            if self.state.installer is not None:
                await self.state.installer.aclose()
            self.state.installer = None
            for runtime in self.state.runtimes.values():
                await runtime.aclose()
            self.state.runtimes = {}
            if self.state.checks is not None:
                await self.state.checks.aclose()
            self.state.checks = None
            if self.state.evals is not None:
                await self.state.evals.aclose()
            self.state.evals = None
            if self.state.benches is not None:
                await self.state.benches.aclose()
            self.state.benches = None
            if self.state.pulls is not None:
                await self.state.pulls.aclose()
            self.state.pulls = None
            if self.state.hf is not None:
                await self.state.hf.aclose()
            self.state.hf = None
            if self.state.models is not None:
                await self.state.models.aclose()
            self.state.models = None
            self.state.facts = None
            # Last, once no run or download holds it: stop the Ollama golem started.
            if self.state.local_servers is not None:
                await self.state.local_servers.aclose()
            self.state.local_servers = None
            self.state.usage = None
            self.state.drafts = None
            if self.state.suggestions is not None:
                await self.state.suggestions.aclose()
            self.state.suggestions = None
            self.state.agent_usage = None
            self.state.notifier = None
            self.state.routines = None
            self.state.watcher = None
            if self.state.workflows is not None:
                await self.state.workflows.aclose()
            self.state.workflows = None
            self.state.routine_runs = None
            if self.state.pairing is not None:
                self.state.pairing.close()
            self.state.pairing = None
            self.state.devices = None
            self.state.sessions = None
            self.state.memory = None
            self._lock.release()

    def _secret(self, name: str) -> str | None:
        """An MCP server's secret, ``mcp/<name>``, from the daemon's store."""
        secrets = self.state.secrets
        return None if secrets is None else secrets.get(name)

    @staticmethod
    def _from_thread(
        loop: asyncio.AbstractEventLoop,
        callback: Callable[[str, bool], None],
        name: str,
        waiting: bool,
    ) -> None:
        loop.call_soon_threadsafe(callback, name, waiting)

    def _keychain_waited(self, name: str, waiting: bool) -> None:
        if waiting:
            log.info("keychain read of %s is waiting on macOS", name)
        provider = name.removeprefix("provider/") if name.startswith("provider/") else None
        self._broadcast(
            KeychainWaitNotification(
                params=KeychainWait(name=name, provider=provider, waiting=waiting)
            )
        )

    def _server_changed(self, server: LocalServer, state: ServerState, message: str | None) -> None:
        status = ModelServerStatus(
            provider=server.provider, base_url=server.base_url, state=state, message=message
        )
        self._broadcast(ModelServerStatusNotification(params=status))

    def _devices_changed(self) -> None:
        """Tell every client, then close the connections of a device that was revoked."""
        self._broadcast(DeviceChangedNotification())
        task = asyncio.create_task(self._close_revoked(), name="golem-close-revoked")
        self._closers.add(task)
        task.add_done_callback(self._closers.discard)

    async def _close_revoked(self) -> None:
        devices = self.state.devices
        if devices is None:
            return
        for connection in list(self._connections):
            device = connection.device
            if device is not None and not await devices.active(device):
                connection.abort()

    def _broadcast_owner(self, notification: BaseModel) -> None:
        """Like :meth:`_broadcast`, but a paired phone's connection does not get it."""
        for connection in list(self._connections):
            if not connection.welcomed or connection.closed or connection.device is not None:
                continue
            with contextlib.suppress(ConnectionResetError):
                connection.enqueue(notification)

    def _broadcast(self, notification: BaseModel) -> None:
        """Queue ``notification`` on every connection that said hello."""
        for connection in list(self._connections):
            if not connection.welcomed or connection.closed:
                continue
            with contextlib.suppress(ConnectionResetError):
                connection.enqueue(notification)

    def _on_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if self._draining or len(self._clients) >= self._max_connections:
            log.warning("rejecting connection")
            _close_soon(writer)
            return
        task = asyncio.create_task(self._serve_client(reader, writer), name="golem-client")
        self._clients.add(task)
        task.add_done_callback(self._client_finished)

    async def _serve_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        connection = ClientConnection(writer)
        self._connections.add(connection)
        log.info("client connected")
        try:
            while not self._draining:
                try:
                    frame = await read_frame(reader)
                except FrameTooLong:
                    await send_failure(connection, PARSE_ERROR, "line too long", None)
                    break
                if frame is None or self._draining:
                    break
                self._dispatcher.spawn(self.state, connection, frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("client loop failed")
        finally:
            log.info("client disconnected")
            if self.state.sessions is not None:
                self.state.sessions.detach_all(connection)
            try:
                await connection.flush(FLUSH_TIMEOUT_SECONDS)
            finally:
                self._connections.discard(connection)
                connection.close()
                writer.close()
            with contextlib.suppress(ConnectionError, OSError):
                await writer.wait_closed()

    async def _shutdown(self) -> None:
        if self.state.models is not None and self.state.models.speeds is not None:
            self.state.models.speeds.save()
        self.state.state = "draining"
        self._draining = True
        if self._server is not None:
            self._server.close()
        if self.state.watcher is not None:
            await self.state.watcher.aclose()
        if self.state.routines is not None:
            await self.state.routines.aclose()
        if self._trimmer is not None:
            await self._trimmer.aclose()
        if self.state.sessions is not None:
            await self.state.sessions.cancel_all()
        await self._dispatcher.drain()
        await asyncio.gather(
            *(connection.flush(FLUSH_TIMEOUT_SECONDS) for connection in self._connections),
        )
        for task in list(self._clients):
            task.cancel()
        if self._clients:
            await asyncio.wait(set(self._clients))
        if self._server is not None:
            await self._server.wait_closed()
        self._unlink_socket()

    async def _listen(self) -> asyncio.Server:
        # umask is process-global. Hold it only across the bind.
        previous = os.umask(0o177)
        try:
            return await asyncio.start_unix_server(
                self._on_client,
                path=os.fspath(self.paths.socket_path),
                limit=MAX_LINE_BYTES,
            )
        finally:
            os.umask(previous)

    def _socket_is_ours(self) -> bool:
        try:
            inode = self.paths.socket_path.stat().st_ino
        except FileNotFoundError:
            return False
        return self._socket_inode is None or inode == self._socket_inode

    async def _watch_socket(self) -> None:
        """Stop once the socket file is gone or replaced, so launchd starts a reachable daemon.

        Deleting ``GOLEM_HOME`` takes the socket with it, and a daemon that
        kept running would answer no one.
        """
        while True:
            await asyncio.sleep(self._socket_check_seconds)
            if not self._socket_is_ours():
                log.warning("socket %s is gone; stopping", self.paths.socket_path)
                self.request_shutdown()
                return

    def _eval_parts_with_local(self) -> EvalParts:
        """The test parts for the measurements, with the service's own local model added."""
        parts = self._eval_parts or EvalParts()
        if parts.local_model is not None:
            return parts
        return dataclasses.replace(
            parts, local_model=lambda: local_model_in_use(self.state.sessions)
        )

    def _unlink_socket(self) -> None:
        # Another daemon's socket at the same path is left alone.
        if not self._socket_is_ours():
            return
        try:
            self.paths.socket_path.unlink()
        except FileNotFoundError:
            return

    def _client_finished(self, task: asyncio.Task[None]) -> None:
        self._clients.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.error("client task failed", exc_info=exc)


def _workflow_session(sessions: SessionManager) -> Callable[[str, str | None, str], Awaitable[str]]:
    """Makes the headless session of a workflow run, with its title."""

    async def create(origin: str, cwd: str | None, title: str) -> str:
        session_id = await sessions.create(None, cwd=cwd, origin=origin)
        await sessions.rename(session_id, title)
        return session_id

    return create


def _price_of(router: ModelRouter, models: ModelDiscovery, profile: str) -> ModelPrice | None:
    """The price of the model a profile name resolves to, or None when it does not resolve."""
    try:
        ref = router.resolve(profile).ref
    except ModelConfigError:
        return None
    return models.price_of(ref)


def _helper_prices(router: ModelRouter, models: ModelDiscovery, profile: str) -> Prices:
    """What the lead of ``profile`` and the helpers it could start cost. No I/O."""
    try:
        ref = router.resolve(profile).ref
    except ModelConfigError:
        return Prices()
    price = models.price_of(ref)
    tier = models.tier_of_ref(ref) or "frontier"
    return prices_of(ref, tier, None if price is None else blended(price), models.cached())


def _is_read_only(tools: ToolRegistry | None, name: str) -> bool:
    tool = None if tools is None else tools.get(name)
    return tool is not None and tool.read_only


def _tier_of(router: ModelRouter, models: ModelDiscovery, profile: str) -> Tier | None:
    """The tier of the model a profile name resolves to, or None when it does not resolve."""
    try:
        ref = router.resolve(profile).ref
    except ModelConfigError:
        return None
    return models.tier_of_ref(ref)


def _notifier_kinds(home: Path) -> Callable[[str | None], NotifierKinds]:
    """Which kinds are on, read from the config at each notice. A routine's own
    ``notify_finished`` and ``notify_failed`` win over ``[notifications]``."""

    def kinds(routine: str | None) -> NotifierKinds:
        try:
            settings = load_settings(home=home, project_dir=home)
        except ValueError:
            log.warning("config.toml does not load; notifications use the defaults")
            return NotifierKinds()
        failed, finished = settings.notifications.failed, settings.notifications.finished
        for item in settings.routine if routine is not None else ():
            if item.name == routine:
                failed = failed if item.notify_failed is None else item.notify_failed
                finished = finished if item.notify_finished is None else item.notify_finished
        return NotifierKinds(failed=failed, finished=finished)

    return kinds


def _open_notifier(records: SessionRecords, bus: EventBus, poster: Poster, home: Path) -> Notifier:
    """The notifier, watching ``bus`` for sessions no client follows."""

    async def lookup(session_id: str) -> SessionFacts | None:
        record = await records.get(session_id)
        return (
            None
            if record is None
            else SessionFacts(record.title, record.origin, record.parent_session_id, record.agent)
        )

    notifier = Notifier(poster, lookup, bus.attached, _notifier_kinds(home))
    bus.observe(notifier.on_event)
    return notifier


@contextlib.asynccontextmanager
async def _open_memory(
    path: Path, settings: MemorySettings, broadcast: Callable[[BaseModel], None]
) -> AsyncGenerator[MemoryService | None]:
    """The memory service over ``memory.db``, or None when ``[memory] enabled = false``.

    Off means the file is not opened, so a daemon that never uses memory never makes one.
    A change goes to every connection as ``memory.changed``.
    """
    if not settings.enabled:
        yield None
        return
    async with MemoryStore.open(path) as store:

        def changed(change: MemoryChange) -> None:
            broadcast(
                MemoryChangedNotification(
                    params=MemoryChanged(
                        id=change.id,
                        change=change.change,
                        scope=change.scope,
                        folder=change.folder,
                    )
                )
            )

        yield MemoryService(store, lambda: settings, changed)


async def _open_sessions(
    database: Database,
    bus: EventBus,
    runtime: ChatRuntime,
    titles: TitleGenerator | None,
    skills: SkillRegistry | None,
    blobs: BlobStore,
    agents: AgentRegistry | None,
) -> SessionManager:
    events = EventLog(database)
    records = SessionRecords(database)
    session_log = SessionLog(events, bus, records)
    runs = RunRecords(database)
    manager = SessionManager(
        runtime,
        session_log,
        records,
        runs,
        titles=titles,
        skills=skills,
        blobs=blobs,
        agents=agents,
    )
    await recover_runs(runs, events, session_log, runtime, manager)
    try:
        await sweep_copies(records)
    except Exception:
        log.exception("could not sweep the copies of helpers")
    return manager


def _install_signals(
    loop: asyncio.AbstractEventLoop,
    callback: Callable[[], None],
) -> list[signal.Signals]:
    installed: list[signal.Signals] = []
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, callback)
        except NotImplementedError:
            continue
        installed.append(sig)
    return installed


def _close_soon(writer: asyncio.StreamWriter) -> None:
    async def _close() -> None:
        writer.close()
        with contextlib.suppress(ConnectionError, OSError):
            await writer.wait_closed()

    task = asyncio.create_task(_close())
    task.add_done_callback(_retrieve)


def _retrieve(task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.debug("close failed", exc_info=exc)


async def serve_forever() -> int:
    """Run the daemon until SIGTERM or SIGINT. Returns a process exit code."""
    paths = resolve_paths()
    # The daemon is per user. Project config is a client concern.
    settings = load_settings(home=paths.home, project_dir=paths.home)
    configure_logging(settings, paths)
    paths.ensure_layout()
    secrets = KeychainSecrets()
    router = ModelRouter(settings, home=paths.home, keys=ProviderKeys(secrets))
    titles = ModelTitles(router) if settings.session_titles else None
    app = DaemonApp(
        paths,
        router=router,
        titles=titles,
        secrets=secrets,
        bundled_skills=bundled_skills_dir(),
        bundled_agents=bundled_agents_dir(),
    )
    try:
        await app.serve()
    except DaemonAlreadyRunning as exc:
        return _refuse_start(paths, exc, describe_lock_held(exc))
    except SocketPathTooLong as exc:
        return _refuse_start(paths, exc, describe_socket_path_too_long(exc.path))
    except DatabaseTooNewError as exc:
        return _refuse_start(paths, exc, describe_database_too_new(exc))
    return 0


def _refuse_start(paths: GolemPaths, exc: Exception, why: tuple[str, str]) -> int:
    """Log, print, and leave ``run/last-error`` for a client that cannot connect."""
    reason, next_step = why
    log.error("%s", exc)
    print(f"{exc}\n{reason}. Next: {next_step}", file=sys.stderr)
    write_start_error(paths, reason, next_step)
    return 1


def class_of(call: Call, bus: EventBus, sessions: SessionManager | None) -> int:
    """The class of a call (ADR-060, section 5). A lower class goes first.

    0 a chat you look at, 1 its helper, 2 any other chat and its helper, 3 an unattended
    run (origin ``routine:*``) and its helper, 4 a job.
    """
    if call.role == "job":
        return 4
    session_id = call.session_id
    origin = None if session_id is None or sessions is None else sessions.origin_of(session_id)
    if session_id is not None and bus.attached(session_id):
        base = 0
    elif origin is not None and origin.startswith("routine:"):
        base = 3
    else:
        base = 2
    return 1 if call.role == "helper" and base == 0 else base


def _apply_ollama_settings(
    local: LocalServers, home: Path, dispatch: ModelDispatcher | None = None
) -> None:
    """Hand a changed ``[ollama]`` table to the local servers. A server golem started
    restarts for a new ``parallel`` the next time a call finds it unused. The lines of the
    dispatcher get the new slot count at once."""
    try:
        settings = load_settings(home=home, project_dir=home).ollama
    except (OSError, ValueError):
        log.debug("config.toml does not load; the local servers keep their settings")
        return
    if settings != local.settings:
        if dispatch is not None and settings.fixed_parallel != local.settings.fixed_parallel:
            dispatch.set_local_slots(settings.fixed_parallel)
        local.settings = settings


async def _stop_idle(
    local: LocalServers, home: Path, dispatch: ModelDispatcher | None = None
) -> None:
    """Stop each Ollama golem started once it has been unused for ``idle_stop_minutes``,
    and pick up a changed ``[ollama]`` setting."""
    while True:
        await asyncio.sleep(_IDLE_CHECK_SECONDS)
        _apply_ollama_settings(local, home, dispatch)
        try:
            await local.stop_idle()
        except Exception:
            log.exception("stopping an idle ollama failed")
