"""``[[routine]]`` in config: what loads, what is refused, and how an error names its line."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from golem.config import GolemSettings, RoutineSettings
from golem.routine_files import read_routines

BRIEF = """# my routines
[[routine]]
name = "morning-brief"
schedule = "weekdays 08:30"
prompt = "/brief"
folder = "~/work"
model = "anthropic/claude-sonnet"
mcp = ["linear"]
missed = "run_once"

[[routine]]
name = "triage"
schedule = "every 1h"
prompt = "Look at the new issues."
enabled = false
"""


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_the_keys_load_and_default(tmp_path: Path) -> None:
    found = read_routines(write(tmp_path, BRIEF))
    assert found.problems == []
    brief, triage = found.routines
    assert (brief.name, brief.schedule, brief.missed, brief.mcp) == (
        "morning-brief",
        "weekdays 08:30",
        "run_once",
        ["linear"],
    )
    assert (triage.missed, triage.enabled, triage.on) == ("skip", False, None)


def test_a_file_without_routines_has_none(tmp_path: Path) -> None:
    assert read_routines(tmp_path / "missing.toml").routines == []
    assert read_routines(write(tmp_path, 'log_level = "INFO"\n')).routines == []


def test_a_routine_has_a_schedule_or_a_trigger_never_both_or_neither() -> None:
    base = {"name": "r", "prompt": "p"}
    RoutineSettings.model_validate({**base, "schedule": "daily 08:30"})
    RoutineSettings.model_validate({**base, "on": {"watch": "~/Downloads", "glob": "*.pdf"}})
    with pytest.raises(ValidationError, match="exactly one of schedule and on"):
        RoutineSettings.model_validate(base)
    with pytest.raises(ValidationError, match="exactly one of schedule and on"):
        RoutineSettings.model_validate(
            {**base, "schedule": "daily 08:30", "on": {"watch": "~/Downloads"}}
        )


@pytest.mark.parametrize("name", ["Brief", "a b", "-x", "a_b", "x" * 41, ""])
def test_a_name_is_lowercase_and_dashes(name: str) -> None:
    with pytest.raises(ValidationError):
        RoutineSettings.model_validate({"name": name, "prompt": "p", "schedule": "daily 08:30"})


def test_a_secret_does_not_go_in_a_routine() -> None:
    with pytest.raises(ValidationError, match="looks like a secret"):
        RoutineSettings.model_validate(
            {"name": "r", "prompt": "p", "schedule": "daily 08:30", "token": "abc"}
        )


def test_a_duplicate_name_is_refused_in_settings_and_in_the_file(tmp_path: Path) -> None:
    text = BRIEF + '\n[[routine]]\nname = "triage"\nschedule = "daily 09:00"\nprompt = "x"\n'
    with pytest.raises(ValidationError, match="two routines are called t"):
        GolemSettings.model_validate(
            {"routine": [{"name": "t", "prompt": "p", "schedule": "daily 08:30"}] * 2}
        )
    found = read_routines(write(tmp_path, text))
    assert [r.name for r in found.routines] == ["morning-brief", "triage"]
    (problem,) = found.problems
    assert "two routines are called triage" in problem.message
    assert problem.line == text.splitlines().index('name = "triage"', 14) + 1


def test_an_error_points_at_the_file_and_the_line(tmp_path: Path) -> None:
    text = BRIEF.replace('"every 1h"', '"every 7m"')
    path = write(tmp_path, text)
    found = read_routines(path)
    assert [r.name for r in found.routines] == ["morning-brief"]
    (problem,) = found.problems
    assert problem.file == str(path)
    assert problem.line == text.splitlines().index('schedule = "every 7m"') + 1
    assert "every takes a step" in problem.message
    assert str(problem).startswith(f"{path}:{problem.line}: ")


def test_a_toml_error_has_a_line(tmp_path: Path) -> None:
    (problem,) = read_routines(write(tmp_path, "[[routine]]\nname = \n")).problems
    assert problem.line == 2


def test_an_unknown_key_is_an_error(tmp_path: Path) -> None:
    (problem,) = read_routines(
        write(
            tmp_path,
            '[[routine]]\nname = "r"\nschedule = "daily 08:30"\nprompt = "p"\ncolour = 1\n',
        )
    ).problems
    assert (problem.message, problem.line) == ("unknown setting", 5)


def test_a_project_routine_stays_inside_the_project(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    (project / "sub").mkdir(parents=True)
    path = write(
        tmp_path,
        '[[routine]]\nname = "in"\nschedule = "daily 08:30"\nprompt = "p"\nfolder = "sub"\n'
        '[[routine]]\nname = "out"\nschedule = "daily 08:30"\nprompt = "p"\nfolder = "/tmp"\n'
        '[[routine]]\nname = "home"\nschedule = "daily 08:30"\nprompt = "p"\nfolder = "~"\n',
    )
    found = read_routines(path, project=project)
    assert [r.name for r in found.routines] == ["in"]
    assert len(found.problems) == 2
    assert all("project folder or inside it" in p.message for p in found.problems)


def test_a_project_routine_names_only_servers_it_sees(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        '[[routine]]\nname = "ok"\nschedule = "daily 08:30"\nprompt = "p"\nmcp = ["linear"]\n'
        '[[routine]]\nname = "bad"\nschedule = "daily 08:30"\nprompt = "p"\nmcp = ["evil"]\n',
    )
    found = read_routines(path, project=tmp_path, known_mcp=frozenset({"linear"}))
    assert [r.name for r in found.routines] == ["ok"]
    assert "evil" in found.problems[0].message


def test_a_project_file_never_puts_its_routines_in_settings(tmp_path: Path) -> None:
    from golem.config import load_settings

    home = tmp_path / "home"
    home.mkdir()
    (home / "config.toml").write_text(BRIEF, encoding="utf-8")
    project = tmp_path / "proj"
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "config.toml").write_text(
        '[[routine]]\nname = "sneaky"\nschedule = "every 1h"\nprompt = "p"\n', encoding="utf-8"
    )
    settings = load_settings(home=home, project_dir=project)
    assert [r.name for r in settings.routine] == ["morning-brief", "triage"]
    # With no user routines at all, the project's still do not appear.
    (home / "config.toml").write_text("", encoding="utf-8")
    assert load_settings(home=home, project_dir=project).routine == []
