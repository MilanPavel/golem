"""``[data.<name>]``: the sources a user or a trusted project names, and what they may hold."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from golem.config import (
    DataSettings,
    DataSourceSettings,
    GolemSettings,
    load_data_sources,
    load_settings,
)
from golem.config_raw import check_text
from golem.secrets import check_name

SHOP = '[data.shop]\npath = "~/shop/*.csv"\nprivacy = "open"\nwatch = true\n'


def _write(folder: Path, text: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_limits_and_sources_share_the_data_table(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _write(home, "[data]\nmax_rows = 50\n" + SHOP.replace("[data.shop]\n", "[data.shop]\n"))
    settings = load_settings(home=home, project_dir=tmp_path)
    assert settings.data.max_rows == 50
    shop = settings.data.sources["shop"]
    assert (shop.path, shop.privacy, shop.watch) == ("~/shop/*.csv", "open", True)
    assert shop.resolved_kind == "files"


def test_privacy_defaults_to_local_and_kind_is_guessed() -> None:
    assert DataSourceSettings(path="~/a.csv").privacy == "local"
    assert DataSourceSettings(path="~/a.sqlite").resolved_kind == "sqlite"
    assert DataSourceSettings(path="~/a.duckdb").resolved_kind == "duckdb"
    assert DataSourceSettings(url="postgres://u@h/db").resolved_kind == "postgres"
    assert DataSourceSettings(path="~/a.csv", kind="duckdb").resolved_kind == "duckdb"


def test_a_source_has_a_path_or_a_url_not_both() -> None:
    with pytest.raises(ValidationError, match="either path"):
        DataSourceSettings()
    with pytest.raises(ValidationError, match="either path"):
        DataSourceSettings(path="a.csv", url="postgres://h/db")


@pytest.mark.parametrize("name", ["1shop", "my-shop", "a b", "_x", "x" * 40])
def test_a_bad_name_is_refused(name: str) -> None:
    with pytest.raises(ValidationError, match="not a source name"):
        DataSettings.model_validate({name: {"path": "a.csv"}})


def test_golem_is_reserved() -> None:
    with pytest.raises(ValidationError, match="built-in source"):
        DataSettings.model_validate({"golem": {"path": "a.csv"}})
    with pytest.raises(ValidationError, match="built-in source"):
        DataSettings.model_validate({"Golem": {"path": "a.csv"}})


def test_a_password_is_only_the_keychain_name_of_its_own_source() -> None:
    ok = DataSettings.model_validate(
        {"shop": {"url": "postgres://u@h/db", "password": "keychain:data/shop"}}
    )
    assert ok.sources["shop"].password == "keychain:data/shop"
    for bad in ("hunter2", "keychain:mcp/shop", "keychain:data/other", "keychain:provider/x"):
        with pytest.raises(ValidationError, match="password"):
            DataSettings.model_validate({"shop": {"url": "postgres://u@h/db", "password": bad}})
    assert check_name("data/shop") == "data/shop"


def test_unknown_keys_in_a_source_are_refused() -> None:
    with pytest.raises(ValidationError):
        DataSettings.model_validate({"shop": {"path": "a.csv", "token": "x"}})


def test_tables_include_and_exclude() -> None:
    source = DataSourceSettings.model_validate(
        {"path": "a.db", "tables": {"include": ["a*"], "exclude": ["audit_log"]}}
    )
    assert source.tables.include == ["a*"]
    assert source.tables.exclude == ["audit_log"]


def test_a_project_file_gives_its_sources_to_load_data_sources_only(tmp_path: Path) -> None:
    home, project = tmp_path / "home", tmp_path / "proj"
    _write(home, "")
    _write(project / ".golem", "[data]\nmax_rows = 5\n" + SHOP)
    assert set(load_data_sources(project / ".golem" / "config.toml")) == {"shop"}
    settings = load_settings(home=home, project_dir=project)
    # The project's sources reach the daemon through the trust check, not through settings.
    assert settings.data.sources == {}
    assert settings.data.max_rows == 5


def test_a_missing_file_has_no_sources(tmp_path: Path) -> None:
    assert load_data_sources(tmp_path / "none.toml") == {}


def test_a_bad_table_in_a_file_raises(tmp_path: Path) -> None:
    path = _write(tmp_path, '[data.golem]\npath = "a.csv"\n')
    with pytest.raises(ValueError, match="built-in"):
        load_data_sources(path)


def test_the_settings_object_validates_a_whole_file() -> None:
    settings = GolemSettings.model_validate(
        {"data": {"query_timeout_seconds": 3, "x": {"url": "mysql://h/d"}}}
    )
    assert settings.data.query_timeout_seconds == 3
    assert settings.data.sources["x"].resolved_kind == "mysql"


def test_the_browser_may_edit_the_limits_but_not_the_sources() -> None:
    before = "[data]\nmax_rows = 10\n"
    limits = check_text("[data]\nmax_rows = 20\n", before)
    assert limits.issues == []
    added = check_text(before + SHOP, before)
    assert [i.path for i in added.issues] == ["data"]
    assert "terminal" in added.issues[0].message
    assert check_text(before + SHOP, before + SHOP).issues == []
    terminal = check_text(before + SHOP, before, protected=False)
    assert terminal.issues == []


def test_a_project_file_may_hold_data_sources() -> None:
    assert check_text(SHOP, "", project=True).issues == []
    bad = check_text("[data]\nmax_rows = 5\n" + SHOP, "", project=True)
    assert [i.path for i in bad.issues] == ["data.max_rows"]
    golem = check_text('[data.golem]\npath = "a.csv"\n', "", project=True)
    assert golem.issues and "built-in" in golem.issues[0].message
