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

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from golem.config import load_settings
from golem.graphs.chat import open_chat
from golem.lock import DaemonAlreadyRunning, DaemonLock
from golem.logging import configure_logging
from golem.models.router import ModelRouter
from golem.paths import GolemPaths, resolve_paths
from golem.server.dispatcher import (
    PARSE_ERROR,
    ClientConnection,
    Dispatcher,
    Method,
    send_failure,
)
from golem.server.framing import MAX_LINE_BYTES, FrameTooLong, read_frame
from golem.server.handlers import standard_methods
from golem.server.state import DaemonState
from golem.sessions.manager import SessionManager

log = logging.getLogger("golem.server")

MAX_CONNECTIONS = 32
# sockaddr_un.sun_path is 104 bytes on macOS, including the trailing NUL.
_MAX_SOCKET_BYTES = 103


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
    ) -> None:
        self.paths = paths
        self._router = router
        self.state = DaemonState(paths=paths, started_at=time.monotonic())
        methods = standard_methods()
        if extra_methods:
            methods.update(extra_methods)
        self._dispatcher = Dispatcher(methods)
        self._max_connections = max_connections
        self._lock = DaemonLock(paths)
        self._server: asyncio.Server | None = None
        self._clients: set[asyncio.Task[None]] = set()
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
        try:
            router = self._router or ModelRouter(
                load_settings(home=self.paths.home, project_dir=self.paths.home),
            )
            async with AsyncSqliteSaver.from_conn_string(str(self.paths.checkpoints_file)) as saver:
                await saver.setup()
                self.state.sessions = SessionManager(open_chat(router, saver))
                try:
                    if install_signals:
                        installed = _install_signals(loop, self.request_shutdown)
                    self._unlink_socket()
                    self._server = await self._listen()
                    os.chmod(self.paths.socket_path, 0o600)
                    log.info("listening on %s", self.paths.socket_path)
                    await self._stop.wait()
                    log.info("shutting down")
                    await self._shutdown()
                finally:
                    for sig in installed:
                        loop.remove_signal_handler(sig)
                    self._unlink_socket()
        finally:
            self.state.sessions = None
            self._lock.release()

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
        connection = ClientConnection(reader, writer)
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

    def _unlink_socket(self) -> None:
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
    app = DaemonApp(paths, router=ModelRouter(settings))
    try:
        await app.serve()
    except DaemonAlreadyRunning as exc:
        log.error("%s", exc)
        print(exc, file=sys.stderr)
        return 1
    except SocketPathTooLong as exc:
        log.error("%s", exc)
        print(exc, file=sys.stderr)
        return 1
    return 0
