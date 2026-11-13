"""``setup.status`` says where golem is installed and which jobs run it."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import cast

import pytest
from test_doctor import FakePlatform
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem import install_info


async def test_setup_status_says_where_golem_is_installed(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("golem.server.handlers.MacPlatform", FakePlatform)

    def not_loaded(_target: str) -> str | None:
        return None

    monkeypatch.setattr("golem.install_info._launchctl_print", not_loaded)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        result = rpc_result(await client.call("setup.status"))
        install = cast(dict[str, object], result["install"])
        assert install["method"] == "dev"
        assert install["daemon_binary"] == sys.executable
        paths = cast(dict[str, str], result["paths"])
        assert paths["home"] == str(app.paths.home)
        assert paths["config"] == str(app.paths.config_file)
        assert paths["logs"] == str(app.paths.log_file)
        assert paths["socket"] == str(app.paths.socket_path)
        jobs = cast(list[dict[str, object]], result["jobs"])
        assert [job["label"] for job in jobs] == ["dev.golem.daemon", "dev.golem.web"]
        assert all(job["loaded"] is False and job["pid"] is None for job in jobs)
    finally:
        await client.close()
        await stop_daemon(app, task)


def _keg(prefix: Path) -> Path:
    daemon = prefix / "Cellar" / "golem" / "1.0.0" / "libexec" / "golem-daemon" / "golem-daemon"
    daemon.parent.mkdir(parents=True)
    daemon.write_text("", encoding="utf-8")
    (prefix / "opt").mkdir()
    (prefix / "opt" / "golem").symlink_to(Path("..") / "Cellar" / "golem" / "1.0.0")
    (prefix / "bin").mkdir()
    (prefix / "bin" / "golem").write_text("", encoding="utf-8")
    return daemon


def test_install_method_follows_how_golem_runs(tmp_path: Path) -> None:
    prefix = tmp_path / "brew"
    brew = install_info.install_facts(frozen=True, executable=_keg(prefix), which=lambda _n: None)
    assert brew.method == "homebrew"
    assert brew.binary == str(prefix / "bin" / "golem")
    assert brew.daemon_binary == str(
        prefix / "opt" / "golem" / "libexec" / "golem-daemon" / "golem-daemon"
    )
    loose = tmp_path / "golem-daemon"
    loose.write_text("", encoding="utf-8")
    script = install_info.install_facts(
        frozen=True, executable=loose, which=lambda _n: "/usr/local/bin/golem"
    )
    assert (script.method, script.binary) == ("script", "/usr/local/bin/golem")
    dev = install_info.install_facts(frozen=False, which=lambda _n: None)
    assert (dev.method, dev.binary) == ("dev", None)


def test_job_facts_read_the_pid_from_launchctl(tmp_path: Path) -> None:
    text = "dev.golem.web = {\n\tstate = running\n\tpid = 4833\n}\n"
    plist = tmp_path / "x.plist"
    job = install_info.job_facts("dev.golem.web", plist, lambda _t: text)
    assert (job.loaded, job.pid) == (True, 4833)
    idle = install_info.job_facts("dev.golem.web", plist, lambda _t: "state = waiting\n")
    assert (idle.loaded, idle.pid) == (True, None)
