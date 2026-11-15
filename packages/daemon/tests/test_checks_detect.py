from pathlib import Path

import pytest
from pydantic import ValidationError

from golem.coding.checks import checks_for, detect
from golem.config import CheckSettings, CodingSettings, load_settings


def _w(root: Path, name: str, text: str = "") -> None:
    (root / name).write_text(text, encoding="utf-8")


def _commands(root: Path) -> list[str]:
    return [c.command for c in detect(root)]


def test_an_empty_folder_has_no_checks(tmp_path: Path) -> None:
    assert detect(tmp_path) == []


@pytest.mark.parametrize("name", ["justfile", "Justfile"])
def test_a_just_lint_recipe(tmp_path: Path, name: str) -> None:
    _w(tmp_path, name, "build:\n  echo\n\nlint:\n  echo\n")
    found = detect(tmp_path)
    assert [(c.name, c.command, c.source) for c in found] == [("lint", "just lint", "detected")]


def test_a_justfile_without_lint(tmp_path: Path) -> None:
    _w(tmp_path, "justfile", "linter:\n  echo\n")
    assert detect(tmp_path) == []


def test_package_scripts(tmp_path: Path) -> None:
    _w(tmp_path, "package.json", '{"scripts": {"lint": "x", "typecheck": "y", "test": "z"}}')
    assert _commands(tmp_path) == ["npm run lint", "npm run typecheck"]


@pytest.mark.parametrize(
    ("lock", "pm"),
    [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ],
)
def test_the_package_manager_follows_the_lock_file(tmp_path: Path, lock: str, pm: str) -> None:
    _w(tmp_path, "package.json", '{"scripts": {"lint": "x"}}')
    _w(tmp_path, lock)
    assert _commands(tmp_path) == [f"{pm} run lint"]


def test_a_broken_package_json_is_skipped(tmp_path: Path) -> None:
    _w(tmp_path, "package.json", "{nope")
    assert detect(tmp_path) == []
    _w(tmp_path, "package.json", "[1]")
    assert detect(tmp_path) == []


def test_ruff_from_pyproject_or_ruff_toml(tmp_path: Path) -> None:
    _w(tmp_path, "pyproject.toml", "[tool.ruff]\nline-length = 99\n")
    assert _commands(tmp_path) == ["ruff check ."]
    other = tmp_path / "b"
    other.mkdir()
    _w(other, "ruff.toml")
    assert _commands(other) == ["ruff check ."]


def test_a_pyproject_without_ruff_or_broken_is_skipped(tmp_path: Path) -> None:
    _w(tmp_path, "pyproject.toml", "[tool.black]\n")
    assert detect(tmp_path) == []
    _w(tmp_path, "pyproject.toml", "[tool.ruff")
    assert detect(tmp_path) == []


def test_cargo_and_go(tmp_path: Path) -> None:
    _w(tmp_path, "Cargo.toml")
    assert _commands(tmp_path) == ["cargo check"]
    _w(tmp_path, "go.mod")
    assert _commands(tmp_path) == ["cargo check", "go vet ./..."]


def test_at_most_four_in_table_order(tmp_path: Path) -> None:
    _w(tmp_path, "justfile", "lint:\n  echo\n")
    _w(tmp_path, "package.json", '{"scripts": {"lint": "x", "typecheck": "y"}}')
    _w(tmp_path, "ruff.toml")
    _w(tmp_path, "Cargo.toml")
    _w(tmp_path, "go.mod")
    assert _commands(tmp_path) == ["just lint", "npm run lint", "npm run typecheck", "ruff check ."]


def test_only_the_folder_itself_is_looked_at(tmp_path: Path) -> None:
    sub = tmp_path / "sub"
    sub.mkdir()
    _w(sub, "Cargo.toml")
    assert detect(tmp_path) == []


def test_configured_checks_replace_detected_ones(tmp_path: Path) -> None:
    _w(tmp_path, "Cargo.toml")
    settings = CodingSettings(check=[CheckSettings(name="tests", command="pytest")])
    found = checks_for(tmp_path, settings)
    assert [(c.name, c.command, c.timeout_seconds, c.source) for c in found] == [
        ("tests", "pytest", 120, "config")
    ]


def test_without_config_checks_for_detects(tmp_path: Path) -> None:
    _w(tmp_path, "Cargo.toml")
    assert [c.command for c in checks_for(tmp_path, CodingSettings())] == ["cargo check"]


def test_off_still_returns_the_list(tmp_path: Path) -> None:
    _w(tmp_path, "Cargo.toml")
    assert len(checks_for(tmp_path, CodingSettings(checks="off"))) == 1


# The daemon loads settings with the project folder set to its home, so a
# session folder's .golem/config.toml never sets [coding]. Only the user's file does.
def _load(tmp_path: Path, text: str) -> CodingSettings:
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.toml").write_text(text, encoding="utf-8")
    return load_settings(home=home, project_dir=tmp_path / "project").coding


def test_the_toml_shape_parses(tmp_path: Path) -> None:
    coding = _load(
        tmp_path,
        '[coding]\nchecks = "auto"\nfix_rounds = 3\n\n'
        '[[coding.check]]\nname = "tests"\ncommand = "pytest -q"\ntimeout_seconds = 300\n',
    )
    assert coding.checks == "auto"
    assert coding.fix_rounds == 3
    assert coding.check == [CheckSettings(name="tests", command="pytest -q", timeout_seconds=300)]


def test_defaults(tmp_path: Path) -> None:
    coding = _load(tmp_path, "")
    assert (coding.checks, coding.fix_rounds, coding.check) == ("ask", 2, [])


@pytest.mark.parametrize("rounds", [-1, 6])
def test_a_bad_fix_rounds_is_refused(tmp_path: Path, rounds: int) -> None:
    with pytest.raises(ValidationError):
        _load(tmp_path, f"[coding]\nfix_rounds = {rounds}\n")
