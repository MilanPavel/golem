"""``python -m golem`` command line.

``serve`` runs the daemon. ``daemon install|start|stop|restart|uninstall`` talk to launchd.
``daemon logs`` prints ``logs/golem.jsonl``. ``doctor`` prints the install
checks as JSON for ``golem doctor``. ``skills check <path>`` validates skills
without a daemon. ``coding bench <model>`` measures how often a model's edits apply.
``evals helpers`` measures helpers on and off in four arms (``--live`` for real models).
The user-facing ``golem`` bin is
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
from typing import cast

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
    doctor.add_argument("--mcp", action="store_true", help="also try each MCP server")
    doctor.set_defaults(func=_doctor)

    skills = sub.add_parser("skills", help="work with skills")
    skills_sub = skills.add_subparsers(dest="action", required=True)
    check = skills_sub.add_parser(
        "check", help="validate a skill folder, its SKILL.md, or a folder of skills"
    )
    check.add_argument("path", type=Path)
    check.set_defaults(func=_skills_check)

    coding = sub.add_parser("coding", help="coding tools that need no daemon")
    coding_sub = coding.add_subparsers(dest="action", required=True)
    bench = coding_sub.add_parser(
        "bench", help="measure how often a model's edits apply, on twelve small tasks"
    )
    bench.add_argument("model", help="a profile name or a provider/model ref")
    bench.add_argument("--task", help="run only the task with this name")
    bench.set_defaults(func=_coding_bench)

    evals = sub.add_parser("evals", help="evals that need no daemon of yours")
    evals_sub = evals.add_subparsers(dest="action", required=True)
    helpers = evals_sub.add_parser(
        "helpers", help="helpers on and off in four arms: quality, time, window, cost, thresholds"
    )
    helpers.add_argument(
        "--live", action="store_true", help="run real models (without it: print the plan only)"
    )
    helpers.add_argument("--arm", action="append", default=[], help="run only this arm")
    helpers.add_argument("--ask", action="append", default=[], help="run only this ask")
    helpers.add_argument(
        "--model", action="append", default=[], metavar="ARM=REF", help="the lead of an arm"
    )
    helpers.add_argument(
        "--allow-tight",
        action="store_true",
        help="also run a local arm whose model is tight in memory",
    )
    helpers.add_argument(
        "--own-risk",
        action="store_true",
        help="run a local arm even when too big or short of room: the Mac may stop answering",
    )
    helpers.add_argument("--project", type=Path, help="the repo the repo-* asks are about")
    helpers.add_argument("--timeout", type=float, default=600, help="seconds a run may take")
    helpers.set_defaults(func=_evals_helpers)
    return parser


def _skills_check(args: argparse.Namespace) -> int:
    from golem.skills.check import check_skills

    report, ok = check_skills(cast(Path, args.path).expanduser())
    print(report)
    return 0 if ok else 1


def _coding_bench(args: argparse.Namespace) -> int:
    """Run the edit tasks on a real model and print the table. A measure, not a gate."""
    import tempfile

    from golem.coding.bench import report, run_all
    from golem.coding.bench_tasks import TASKS
    from golem.config import load_settings
    from golem.models.keys import ProviderKeys
    from golem.models.router import ModelConfigError, ModelRouter
    from golem.secrets import KeychainSecrets

    wanted = cast("str | None", args.task)
    tasks = [task for task in TASKS if wanted is None or task.name == wanted]
    if not tasks:
        print(f"no task named {wanted}; the tasks are {', '.join(t.name for t in TASKS)}")
        return 1
    paths = resolve_paths()
    settings = load_settings(home=paths.home, project_dir=paths.home)
    router = ModelRouter(settings, home=paths.home, keys=ProviderKeys(KeychainSecrets()))
    try:
        model = router.chat_model(cast(str, args.model))
    except ModelConfigError as exc:
        print(exc, file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(prefix="golem-bench-") as folder:
        results = asyncio.run(run_all(model, tasks, Path(folder)))
    print(report(results))
    return 0


def _evals_helpers(args: argparse.Namespace) -> int:
    """Run the helper eval, or print its plan without ``--live``. A measure, not a gate."""
    from golem.evals.helpers import command

    return command(
        live=cast(bool, args.live),
        arm_names=cast("list[str]", args.arm),
        ask_names=cast("list[str]", args.ask),
        models=cast("list[str]", args.model),
        project=cast("Path | None", args.project),
        timeout=cast(float, args.timeout),
        allow_tight=cast(bool, args.allow_tight),
        own_risk=cast(bool, args.own_risk),
    )


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


def _doctor(args: argparse.Namespace) -> int:
    """Print the checks as one JSON array. The CLI decides the exit code."""
    from golem.doctor import MacPlatform, live_mcp, run_checks
    from golem.models.keys import ProviderKeys
    from golem.secrets import KeychainSecrets

    secrets = KeychainSecrets()
    paths = resolve_paths()
    checks = run_checks(
        paths,
        MacPlatform(),
        ProviderKeys(secrets),
        secrets.get,
        live_mcp=None if args.mcp else live_mcp(paths),
        probe_mcp=args.mcp,
    )
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
