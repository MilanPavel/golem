"""Workflow files are found, trusted and loaded in a subprocess."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from golem.workflows import WorkflowRegistry

OK = '''
from golem.workflow import workflow, schedule

@workflow(trigger=schedule("weekly mon 06:00"), inputs={"n": int})
def digest(run, n):
    """Make the digest."""
'''


def make(tmp_path: Path, trusted: bool = True, timeout: float = 10.0) -> WorkflowRegistry:
    project = tmp_path / "proj"
    (project / "workflows").mkdir(parents=True, exist_ok=True)
    return WorkflowRegistry(
        user_dir=tmp_path / "home" / "workflows",
        projects=lambda: [project],
        trusted=lambda _p: trusted,
        load_timeout=timeout,
    )


def put(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / "proj" / "workflows" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def only(reg: WorkflowRegistry):
    reg.refresh()
    entries = reg.entries()
    assert len(entries) == 1
    return entries[0]


def test_ok_file(tmp_path: Path) -> None:
    put(tmp_path, "a.py", OK)
    e = only(make(tmp_path))
    assert e.state == "ok" and e.spec is not None
    assert e.name == "digest" and e.spec.description == "Make the digest."
    assert e.spec.inputs == (("n", "int"),)
    assert e.spec.trigger is not None and e.spec.trigger.kind == "schedule"


def test_two_workflows_in_one_file(tmp_path: Path) -> None:
    put(tmp_path, "a.py", OK + OK.replace("digest", "other").split("\n", 3)[3])
    reg = make(tmp_path)
    reg.refresh()
    assert sorted(e.name for e in reg.entries()) == ["digest", "other"]
    assert all(e.state == "ok" for e in reg.entries())


@pytest.mark.parametrize(
    ("body", "text"),
    [
        ("def (:\n", "SyntaxError"),
        ("raise RuntimeError('boom')\n", "boom"),
        ("import sys\nsys.exit(3)\n", "SystemExit"),
        ("x = 1\n", "no @workflow"),
        ("from golem.workflow import schedule\nschedule('nonsense')\n", "not a schedule"),
    ],
)
def test_broken(tmp_path: Path, body: str, text: str) -> None:
    put(tmp_path, "a.py", body)
    e = only(make(tmp_path))
    assert e.state == "broken" and e.error is not None and text in e.error


def test_hard_exit(tmp_path: Path) -> None:
    put(tmp_path, "a.py", "import os\nos._exit(4)\n")
    e = only(make(tmp_path))
    assert e.state == "broken" and e.error is not None and "exit 4" in e.error


def test_hang(tmp_path: Path) -> None:
    put(tmp_path, "a.py", "while True:\n    pass\n")
    e = only(make(tmp_path, timeout=1.0))
    assert e.state == "broken" and e.error is not None and "longer than" in e.error


def test_untrusted_not_imported(tmp_path: Path) -> None:
    marker = tmp_path / "marker"
    put(tmp_path, "a.py", f"open({str(marker)!r}, 'w').close()\n")
    e = only(make(tmp_path, trusted=False))
    assert e.state == "untrusted" and e.spec is None
    assert not marker.exists()


def test_duplicate_name(tmp_path: Path) -> None:
    put(tmp_path, "a.py", OK)
    put(tmp_path, "b.py", OK)
    reg = make(tmp_path)
    reg.refresh()
    assert [e.state for e in reg.entries()] == ["broken", "broken"]
    assert all(e.error == "name used twice" for e in reg.entries())


def test_refresh_edit_and_delete(tmp_path: Path) -> None:
    path = put(tmp_path, "a.py", OK)
    reg = make(tmp_path)
    assert reg.refresh() is True
    assert reg.refresh() is False
    path.write_text(OK.replace("digest", "renamed"))
    os.utime(path, ns=(1, 10**18))
    assert reg.refresh() is True
    assert [e.name for e in reg.entries()] == ["renamed"]
    path.unlink()
    assert reg.refresh() is True
    assert reg.entries() == []
