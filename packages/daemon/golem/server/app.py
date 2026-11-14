"""Unix-socket server. Owns the pid lock, the socket, and shutdown."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from pydantic import BaseModel

from golem.config import load_settings
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.prompt import SystemPrompt
from golem.lock import DaemonAlreadyRunning, DaemonLock
from golem.logging import configure_logging
from golem.mcp import McpSupervisor
from golem.mcp.prompt import mcp_section
from golem.models.discovery import ModelDiscovery
from golem.models.install import RUNTIMES, OllamaInstaller, runtime_installer
from golem.models.keys import ProviderKeys
from golem.models.ollama import LocalServer, LocalServers, ServerState
from golem.models.pulls import PullManager
from golem.models.router import ModelRouter
from golem.models.window import resolve_window
from golem.paths import GolemPaths, resolve_paths
from golem.permissions.policy import Policy
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
from golem.server.start_error import (
    clear_start_error,
    describe_database_too_new,
    describe_lock_held,
    describe_socket_path_too_long,
    write_start_error,
)
from golem.server.state import DaemonState
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import recover_runs
from golem.sessions.titles import ModelTitles, TitleGenerator
from golem.skills.bundled import bundled_skills_dir
from golem.skills.pinned import pinned_section
from golem.skills.registry import SkillRegistry
from golem.store.artifacts import ArtifactStore
from golem.store.blobs import BlobStore
from golem.store.checkpoints import open_checkpoints
from golem.store.database import Database, DatabaseTooNewError
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.registry import ToolScope
from golem_protocol.commands import KeychainWait, ModelServerStatus
from golem_protocol.rpc import KeychainWaitNotification, ModelServerStatusNotification

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
        pulls: Callable[[ModelRouter, float | None], PullManager] | None = None,
        mcp: McpSupervisor | None = None,
        secrets: SecretStore | None = None,
        user_home: Path | None = None,
        bundled_skills: Path | None = None,
        local_servers: LocalServers | None = None,
        socket_check_seconds: float = SOCKET_CHECK_SECONDS,
    ) -> None:
        self.paths = paths
        self._socket_check_seconds = socket_check_seconds
        self._socket_inode: int | None = None
        self._user_home = user_home
        self._bundled_skills = bundled_skills
        self._router = router
        self._titles = titles
        self._discovery = discovery
        self._pulls = pulls
        self._mcp = mcp
        self._local = local_servers
        self.state = DaemonState(
            paths=paths, started_at=time.monotonic(), secrets=secrets, user_home=user_home
        )
        self.state.broadcast = self._broadcast
        methods = standard_methods()
        if extra_methods:
            methods.update(extra_methods)
        self._dispatcher = Dispatcher(methods)
        self._max_connections = max_connections
        self._lock = DaemonLock(paths)
        self._server: asyncio.Server | None = None
        self._clients: set[asyncio.Task[None]] = set()
        self._connections: set[ClientConnection] = set()
        self._stop = asyncio.Event()
        self._draining = False

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
            if self._discovery is None:
                models = ModelDiscovery(router, self.paths.cache_dir)
            else:
                models = self._discovery(router)

            async def note_loaded(profile: str, sent_num_ctx: int | None) -> int | None:
                resolved = router.resolve(profile)
                if resolved.provider.kind != "ollama":
                    return None
                return await models.note_loaded(resolved.ref, sent_num_ctx)

            async with (
                Database.open(self.paths.database_file) as database,
                open_checkpoints(database, self.paths.checkpoints_file) as saver,
            ):
                self.state.policy = policy
                self.state.tools = default_registry(mcp, policy.web())
                self.state.artifacts = ArtifactStore(database)
                chat = open_chat(
                    router,
                    saver,
                    self.state.tools,
                    self.state.policy,
                    self.state.artifacts,
                    local,
                    SystemPrompt(sections=(pinned_section(self.state.skills), mcp_section(mcp))),
                    BlobStore(database),
                    window_of=lambda profile, overrides: resolve_window(
                        router, profile, models, overrides=overrides
                    ),
                    note_loaded=note_loaded,
                )
                self.state.sessions = await _open_sessions(
                    database,
                    chat,
                    self._titles,
                    self.state.skills,
                    BlobStore(database),
                )
                sessions = self.state.sessions

                async def enable_mcp(session_id: str, scope: ToolScope, name: str) -> list[str]:
                    return await turn_on_for_model(sessions, mcp, session_id, scope, name)

                chat.enable_mcp = enable_mcp
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
                self.state.pulls = pulls
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
                    idle = asyncio.create_task(_stop_idle(local), name="golem-ollama-idle")
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
            if self.state.skills is not None:
                await self.state.skills.aclose()
            self.state.skills = None
            if self.state.installer is not None:
                await self.state.installer.aclose()
            self.state.installer = None
            for runtime in self.state.runtimes.values():
                await runtime.aclose()
            self.state.runtimes = {}
            if self.state.pulls is not None:
                await self.state.pulls.aclose()
            self.state.pulls = None
            if self.state.models is not None:
                await self.state.models.aclose()
            self.state.models = None
            # Last, once no run or download holds it: stop the Ollama golem started.
            if self.state.local_servers is not None:
                await self.state.local_servers.aclose()
            self.state.local_servers = None
            self.state.sessions = None
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
        self.state.state = "draining"
        self._draining = True
        if self._server is not None:
            self._server.close()
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


async def _open_sessions(
    database: Database,
    runtime: ChatRuntime,
    titles: TitleGenerator | None,
    skills: SkillRegistry | None,
    blobs: BlobStore,
) -> SessionManager:
    events = EventLog(database)
    records = SessionRecords(database)
    session_log = SessionLog(events, EventBus(), records)
    runs = RunRecords(database)
    await recover_runs(runs, events, session_log, runtime)
    return SessionManager(
        runtime, session_log, records, runs, titles=titles, skills=skills, blobs=blobs
    )


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


async def _stop_idle(local: LocalServers) -> None:
    """Stop each Ollama golem started once it has been unused for ``idle_stop_minutes``."""
    while True:
        await asyncio.sleep(_IDLE_CHECK_SECONDS)
        try:
            await local.stop_idle()
        except Exception:
            log.exception("stopping an idle ollama failed")
