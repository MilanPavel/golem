"""``python -m golem`` command line.

``serve`` runs the daemon. ``daemon install|start|stop|restart|uninstall`` talk to launchd.
``daemon logs`` prints ``logs/golem.jsonl``. ``doctor`` prints the install
checks as JSON for ``golem doctor``. The user-facing ``golem`` bin is
the TypeScript package; it delegates these subcommands here.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path

from golem import __version__
from golem.launchd import LaunchdError, install, restart, start, stop, uninstall
from golem.paths import resolve_paths

_LOG_TAIL = 50


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        result = args.func(args)
    except LaunchdError as exc:
        print(exc, file=sys.stderr)
        return 1
    return int(result)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="golem")
    parser.add_argument(
        "--version",
        action="version",
        version=f"golem-daemon {__version__}",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the daemon in the foreground")
    serve.set_defaults(func=_serve)

    daemon = sub.add_parser("daemon", help="manage the launchd agent")
    daemon_sub = daemon.add_subparsers(dest="action", required=True)

    install_cmd = daemon_sub.add_parser("install", help="write the plist and load it")
    install_cmd.set_defaults(func=_install)

    start_cmd = daemon_sub.add_parser("start", help="start the loaded agent")
    start_cmd.set_defaults(func=_start)

    stop_cmd = daemon_sub.add_parser("stop", help="unload the agent so it stays down")
    stop_cmd.set_defaults(func=_stop)

    restart_cmd = daemon_sub.add_parser(
        "restart", help="replace the running daemon, after an upgrade"
    )
    restart_cmd.set_defaults(func=_restart)

    uninstall_cmd = daemon_sub.add_parser("uninstall", help="unload the agent and delete the plist")
    uninstall_cmd.set_defaults(func=_uninstall)

    logs = daemon_sub.add_parser("logs", help="show the daemon log")
    group = logs.add_mutually_exclusive_group()
    group.add_argument("--follow", action="store_true", help="keep streaming the log")
    group.add_argument("--no-follow", action="store_true", help="print the last lines and exit")
    logs.set_defaults(func=_logs)

    doctor = sub.add_parser("doctor", help="check this install, as JSON for `golem doctor`")
    doctor.set_defaults(func=_doctor)
    return parser


def _serve(_args: argparse.Namespace) -> int:
    from golem.server.app import serve_forever

    return asyncio.run(serve_forever())


def _install(_args: argparse.Namespace) -> int:
    install()
    return 0


def _start(_args: argparse.Namespace) -> int:
    start()
    return 0


def _stop(_args: argparse.Namespace) -> int:
    stop()
    return 0


def _restart(_args: argparse.Namespace) -> int:
    restart()
    return 0


def _uninstall(_args: argparse.Namespace) -> int:
    uninstall()
    return 0


def _doctor(_args: argparse.Namespace) -> int:
    """Print the checks as one JSON array. The CLI decides the exit code."""
    from golem.doctor import MacPlatform, run_checks
    from golem.models.keys import ProviderKeys
    from golem.secrets import KeychainSecrets

    secrets = KeychainSecrets()
    checks = run_checks(resolve_paths(), MacPlatform(), ProviderKeys(secrets), secrets.get)
    print(json.dumps([asdict(check) for check in checks]))
    return 0


def _logs(args: argparse.Namespace) -> int:
    follow: bool | None
    if args.follow:
        follow = True
    elif args.no_follow:
        follow = False
    else:
        follow = None
    return tail_logs(follow=follow)


def tail_logs(*, follow: bool | None) -> int:
    """Print the last log lines. Follow when ``follow`` is true or stdout is a terminal."""
    path = resolve_paths().log_file
    if not path.is_file():
        print(f"log file not found: {path}", file=sys.stderr)
        return 1
    if follow is None:
        follow = sys.stdout.isatty()
    lines = _read_lines(path)
    for line in lines[-_LOG_TAIL:]:
        print(line)
    if not follow:
        return 0
    try:
        _follow(path)
    except KeyboardInterrupt:
        return 0
    return 0


def _read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


def _follow(path: Path) -> None:
    with path.open(encoding="utf-8") as handle:
        handle.seek(0, os.SEEK_END)
        while True:
            line = handle.readline()
            if line:
                sys.stdout.write(line)
                sys.stdout.flush()
            else:
                time.sleep(0.2)


if __name__ == "__main__":
    raise SystemExit(main())
