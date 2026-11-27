"""Postgres and MySQL sources: the address, the guard, the engine over a stand-in, the Keychain.

No server is needed. The engine tests attach a DuckDB file where the scanner would attach a
server, and answer the version and grants questions with a macro. The live tests at the end run
only with ``GOLEM_TEST_PG_URL`` or ``GOLEM_TEST_MYSQL_URL`` set and the extension installed.
"""
# pyright: reportPrivateUsage=false

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any, cast
from urllib.parse import unquote, urlsplit

import duckdb
import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import DataSettings, load_data_sources
from golem.data import engine
from golem.data.client import DataWorker
from golem.data.database import (
    DatabaseTarget,
    build_url,
    connection_string,
    parse_url,
    privileges_can_write,
    version_label,
)
from golem.data.engine import Limits, Source, attach_server, extension_installed, redact
from golem.data.guard import SERVER_FUNCTIONS, SERVER_PREFIXES, refusal
from golem.data.sources import DataSources
from golem.data.tools import DATA_QUERY
from golem.data.types import DataError, SourceSpec
from golem.memory.privacy import Target
from golem.paths import GolemPaths
from golem.secrets import MemorySecrets
from golem.server.data_rpc import wire_source
from golem.server.dispatcher import INVALID_PARAMS
from golem.tools.registry import ToolContext

PASSWORD = "s3cr3t-pw'&=x"
HOSTED = Target(local=False)
ON_DEVICE = Target(local=True)


# -- the address -----------------------------------------------------------------------------


def test_an_address_is_read_into_its_parts() -> None:
    target = parse_url("postgres://golem_ro@db.example.com:6543/shop%20dev?sslmode=require")
    assert target == DatabaseTarget(
        "postgres", "db.example.com", 6543, "shop dev", "golem_ro", "require"
    )
    assert parse_url("postgresql://localhost/shop").kind == "postgres"
    mysql = parse_url("mysql://u@h/d?ssl_mode=required")
    assert (mysql.kind, mysql.port, mysql.ssl_mode) == ("mysql", None, "required")


def test_an_address_with_a_password_is_refused_and_does_not_repeat_it() -> None:
    with pytest.raises(DataError) as caught:
        parse_url(f"postgres://golem_ro:{PASSWORD}@localhost:5432/shop")
    assert "Keychain" in str(caught.value)
    assert "s3cr3t" not in str(caught.value)


@pytest.mark.parametrize(
    "url",
    ["http://h/d", "postgres://u@h", "postgres:///d", "postgres://u@h/d?sslmode=bogus", "x"],
)
def test_a_bad_address_says_what_is_wrong(url: str) -> None:
    with pytest.raises(DataError):
        parse_url(url)


def test_an_address_built_from_fields_reads_back_the_same() -> None:
    target = DatabaseTarget("mysql", "10.0.0.5", 3307, "my db", "read only", "preferred")
    assert parse_url(build_url(target)) == target
    assert PASSWORD not in build_url(target)
    with pytest.raises(DataError):
        build_url(DatabaseTarget("postgres", "bad host;drop", None, "d", None))


def test_the_connection_string_reads_only_cuts_slow_queries_and_quotes_the_password() -> None:
    target = parse_url("postgres://golem_ro@db.example.com/shop")
    text = connection_string(target, PASSWORD, 15)
    assert "default_transaction_read_only=on" in text and "statement_timeout=15000" in text
    assert "dbname='shop'" in text and "user='golem_ro'" in text
    assert "password='s3cr3t-pw\\'&=x'" in text
    assert "password" not in connection_string(target, None, 15)
    mysql = connection_string(parse_url("mysql://u@h:3307/d"), "p", 5)
    assert 'port="3307"' in mysql and 'database="d"' in mysql and 'password="p"' in mysql
    tricky = connection_string(parse_url("mysql://u@h/d"), 'a"b\\c', 5)
    assert 'password="a\\"b\\\\c"' in tricky


def test_privileges_that_change_data_are_found() -> None:
    assert not privileges_can_write(["USAGE", "SELECT", "SHOW VIEW", "ALTER ROUTINE"])
    assert privileges_can_write(["USAGE", "SELECT", "INSERT"])
    assert privileges_can_write(["delete"])
    assert not privileges_can_write([])


def test_the_version_is_a_short_label() -> None:
    assert version_label(
        "postgres", "PostgreSQL 17.2 (Debian 17.2-1) on aarch64-unknown-linux"
    ) == ("PostgreSQL 17.2")
    assert version_label("mysql", "8.0.36-0ubuntu1") == "MySQL 8.0.36"
    assert version_label("mysql", "10.11.6-MariaDB") == "MariaDB 10.11.6"


# -- the config -------------------------------------------------------------------------------


def test_a_config_with_a_password_in_the_address_is_refused_without_repeating_it(
    tmp_path: Path,
) -> None:
    file = tmp_path / "config.toml"
    file.write_text(f'[data.shop]\nurl = "postgres://u:{PASSWORD}@h/d"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="Keychain") as caught:
        load_data_sources(file)
    assert "s3cr3t" not in str(caught.value)


def test_a_database_source_names_its_password_by_reference(tmp_path: Path) -> None:
    file = tmp_path / "config.toml"
    file.write_text(
        '[data.shop]\nurl = "postgres://u@h:5432/d"\npassword = "keychain:data/shop"\n'
        "timeout_s = 5\n",
        encoding="utf-8",
    )
    found = load_data_sources(file)["shop"]
    assert found.resolved_kind == "postgres" and found.timeout_s == 5
    file.write_text(
        '[data.shop]\nurl = "postgres://u@h/d"\npassword = "hunter2"\n', encoding="utf-8"
    )
    with pytest.raises(ValueError, match="never the password"):
        load_data_sources(file)


# -- the guard --------------------------------------------------------------------------------


@pytest.mark.parametrize("name", sorted(SERVER_FUNCTIONS))
def test_every_function_that_reaches_a_server_is_refused(name: str) -> None:
    reason = refusal(f"select * from {name}('src', 'select 1')")
    assert reason is not None and name in reason


@pytest.mark.parametrize(
    "sql",
    [
        "select * from postgres_query('src', 'select 1')",
        "select * from mysql_query('src', 'select 1')",
        "select postgres_execute('src', 'delete from t')",
        "call postgres_execute('src', 'delete from t')",
        "call mysql_execute('src', 'delete from t')",
        "attach 'host=h' as other (type postgres)",
        "detach src",
        "use other",
        "set statement_timeout = 0",
        "pragma postgres_clear_cache",
    ],
)
def test_the_guard_refuses_what_could_write_or_reconnect(sql: str) -> None:
    assert refusal(sql) is not None


def _extension_functions() -> list[str]:
    """Every function the installed scanner extensions add, plus any with a scanner prefix."""
    directory = Path(os.environ.get("GOLEM_TEST_EXTENSION_DIR", "~/.golem/data/extensions"))
    directory = directory.expanduser()
    names: set[str] = set()
    connection = duckdb.connect()
    base = {
        r[0] for r in connection.execute("select function_name from duckdb_functions()").fetchall()
    }
    for kind, file in (
        ("postgres", "postgres_scanner"),
        ("mysql", "mysql_scanner"),
        ("sqlite", "sqlite_scanner"),
    ):
        if not extension_installed(directory, kind):
            continue
        loaded = duckdb.connect()
        loaded.execute(f"set extension_directory = '{directory}'")
        try:
            loaded.execute(f"load {file}")
        except duckdb.Error:
            continue
        rows = loaded.execute("select distinct function_name from duckdb_functions()").fetchall()
        names |= {str(r[0]) for r in rows} - base
    names |= {n for n in base if n.lower().startswith(SERVER_PREFIXES)}
    return sorted(n for n in names if n.isidentifier())


def test_every_function_of_a_scanner_extension_is_refused() -> None:
    found = _extension_functions()
    if not found:
        pytest.skip("no scanner extension is installed here")
    for name in found:
        assert refusal(f"select * from {name}('a', 'b')") is not None, name
        assert refusal(f"select {name}('a', 'b')") is not None, name


@pytest.mark.parametrize("name", ["postgres_new_thing", "MySQL_Other", "sqlite_future"])
def test_a_function_with_a_scanner_prefix_is_refused_even_when_unlisted(name: str) -> None:
    assert refusal(f"select * from {name}('a')") is not None
    assert refusal(f"select {name}('a')") is not None


def test_the_attached_catalog_itself_is_still_readable() -> None:
    assert refusal("select * from src.information_schema.tables") is None
    assert refusal("select * from src.app.orders") is None


# -- the engine over a stand-in ---------------------------------------------------------------

STAND_IN = """
create macro postgres_query(d, q) as table
select * from (
  select 'PostgreSQL 17.2 on aarch64' as a, null::varchar as b, null::bigint as c
    where q like 'select version%'
  union all select 'public', 'orders', 3 where q like '%reltuples%'
  union all select 'app', 'invoices', 2 where q like '%reltuples%'
  union all select 'app', 'big', 40000000 where q like '%reltuples%'
  union all select '1', null, null where q like '%has_table_privilege%'
)
"""


@pytest.fixture
def database(tmp_path: Path) -> Path:
    path = tmp_path / "server.duckdb"
    connection = duckdb.connect(str(path))
    connection.execute("create schema public; create schema app")
    connection.execute("create table public.orders (id integer, total double)")
    connection.execute("insert into public.orders values (1, 10), (2, 32.5), (3, 7)")
    connection.execute("create table app.invoices (n integer, who varchar)")
    connection.execute("insert into app.invoices values (1, 'ada'), (2, 'bob')")
    connection.execute("create table app.big (n integer)")
    connection.execute("create view public.cheap as select * from public.orders where total < 20")
    connection.close()
    return path


@pytest.fixture
def standin(database: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[list[SourceSpec]]:
    """Attach ``database`` where the scanner would attach a server."""
    seen: list[SourceSpec] = []

    def attach(connection: Any, spec: SourceSpec, target: DatabaseTarget) -> None:
        del target
        seen.append(spec)
        connection.execute(f"attach '{database}' as src (read_only)")
        connection.execute(STAND_IN)

    monkeypatch.setattr(engine, "attach_server", attach)

    def load(self: Source, extension: str, file: str, limits: Limits) -> None:
        del self, extension, file, limits

    monkeypatch.setattr(Source, "_load", load)
    yield seen


def _open(tmp_path: Path, kind: str = "postgres") -> Source:
    spec = SourceSpec("shop", kind, f"{kind}://golem_ro@db.example.com/shop", PASSWORD)  # type: ignore[arg-type]
    return Source(spec, Limits(extension_dir=tmp_path / "ext", temp_dir=tmp_path / "tmp"))


def test_the_tables_are_schema_dot_table_and_public_is_bare(
    tmp_path: Path, standin: list[SourceSpec]
) -> None:
    source = _open(tmp_path)
    names = {table["name"]: table for table in source.tables()}
    assert set(names) == {"orders", "cheap", "app.invoices", "app.big"}
    assert names["cheap"]["type"] == "view" and names["orders"]["type"] == "table"
    assert standin[0].password == PASSWORD


def test_row_counts_are_the_servers_estimates_and_nothing_is_counted(
    tmp_path: Path, standin: list[SourceSpec]
) -> None:
    source = _open(tmp_path)
    rows = {table["name"]: table["rows"] for table in source.tables()}
    assert rows == {"orders": 3, "app.invoices": 2, "app.big": 40_000_000, "cheap": None}
    described = source.describe("app.big")
    assert described["rows"] == 40_000_000
    assert [c["name"] for c in described["columns"]] == ["n"]
    assert described["columns"][0]["min"] is None and described["columns"][0]["distinct"] is None


def test_describe_lists_columns_from_the_catalog(tmp_path: Path, standin: list[SourceSpec]) -> None:
    source = _open(tmp_path)
    columns = source.describe("orders")["columns"]
    assert [(c["name"], c["type"]) for c in columns] == [("id", "INTEGER"), ("total", "DOUBLE")]
    with pytest.raises(DataError, match="There is no table called nope"):
        source.describe("nope")


def test_the_server_version_and_the_write_answer_come_with_the_attach(
    tmp_path: Path, standin: list[SourceSpec]
) -> None:
    source = _open(tmp_path)
    assert source.info == {"version": "PostgreSQL 17.2", "can_write": True}


def test_queries_use_bare_and_qualified_names_and_the_lock_holds(
    tmp_path: Path, standin: list[SourceSpec]
) -> None:
    source = _open(tmp_path)
    assert source.query("select count(*) from orders", 10)["rows"] == [[3]]
    assert source.query("select who from app.invoices order by n", 10)["rows"] == [["ada"], ["bob"]]
    for sql, fragment in [
        ("update orders set total = 0", "Only queries that read"),
        ("select * from postgres_query('src', 'delete from orders')", "cannot send SQL"),
        ("attach 'x.db' as y", "cannot attach"),
        ("set enable_external_access = true", "cannot attach"),
    ]:
        with pytest.raises(DataError, match=fragment):
            source.query(sql, 10)
    # Past the guard, DuckDB's own lock still holds.
    cursor = source.cursor()
    for sql in ["attach 'x.db' as y", "set enable_external_access = true", "set threads = 99"]:
        with pytest.raises(duckdb.Error):
            cursor.execute(sql)
    cursor.close()
    assert source.query("select count(*) from orders", 10)["rows"] == [[3]]


def test_a_failed_connection_hides_the_password_in_what_duckdb_says() -> None:
    spec = SourceSpec("shop", "postgres", "postgres://u@h/d", PASSWORD)
    target = parse_url(spec.location)
    text = connection_string(target, PASSWORD, 15)
    sent: list[str] = []

    class Refusing:
        def execute(self, sql: str) -> None:
            sent.append(sql)
            raise duckdb.IOException(f'Unable to connect to Postgres at "{text}": refused')

    with pytest.raises(DataError) as caught:
        attach_server(Refusing(), spec, target)
    assert "password" in sent[0] and "s3cr3t" in sent[0]  # the password does reach ATTACH ...
    assert "s3cr3t" not in str(caught.value)  # ... and never an error
    assert "refused" in str(caught.value) and "password=***" in str(caught.value)
    # A worker that opened a source with it knows the password and hides it anywhere.
    engine._passwords.update({PASSWORD, PASSWORD.replace("'", "\\'")})
    escaped = PASSWORD.replace("'", "\\'")
    assert "s3cr3t" not in redact(f"failed with {PASSWORD} in it and {escaped}")
    assert redact("host=h password='abc def' x") == "host=h password=*** x"


# -- the daemon side, with a fake worker ------------------------------------------------------


class FakeWorker(DataWorker):
    """Stands where the worker process stands, and keeps what the daemon sent it."""

    def __init__(self, paths: GolemPaths, can_write: bool = False) -> None:
        super().__init__(DataSettings(), paths)
        self.attached: list[SourceSpec] = []
        self.queries: list[str] = []
        self.can_write = can_write

    async def attach(self, spec: SourceSpec) -> list[dict[str, Any]]:
        self.attached.append(spec)
        return [{"name": "orders", "type": "table", "rows": 3}]

    def server_info(self, name: str) -> dict[str, Any]:
        return {"version": "PostgreSQL 17.2", "can_write": self.can_write}

    async def detach(self, name: str) -> None:
        return None

    async def describe(self, source: str, table: str) -> dict[str, Any]:
        columns = [
            {"name": "id", "type": "INTEGER", "min": None, "max": None, "distinct": None},
            {"name": "total", "type": "DOUBLE", "min": None, "max": None, "distinct": None},
        ]
        return {"table": table, "rows": 3, "columns": columns}

    async def query(
        self,
        source: str,
        sql: str,
        limit: int | None = None,
        *,
        result_id: str | None = None,
        store: Path | None = None,
    ) -> dict[str, Any]:
        self.queries.append(sql)
        return {
            "columns": [{"name": "total", "type": "DOUBLE"}],
            "rows": [[32.5]],
            "truncated": False,
            "elapsed_ms": 1,
        }


@pytest.fixture
def paths(tmp_path: Path) -> GolemPaths:
    found = GolemPaths(tmp_path / "home")
    found.ensure_layout()
    marker = found.data_extensions_dir / "v1" / "postgres_scanner.duckdb_extension"
    marker.parent.mkdir(parents=True)
    marker.write_text("x")
    assert extension_installed(found.data_extensions_dir, "postgres")
    return found


@pytest.fixture
async def sources(
    paths: GolemPaths,
) -> AsyncIterator[tuple[DataSources, FakeWorker, MemorySecrets]]:
    worker = FakeWorker(paths)
    found = DataSources(worker, paths)
    store = MemorySecrets({"data/shop": PASSWORD})
    found.secrets = store
    yield found, worker, store
    await found.close()


def _shop_config(paths: GolemPaths, privacy: str = "local") -> None:
    paths.config_file.write_text(
        '[data.shop]\nurl = "postgres://golem_ro@db.example.com:5432/shop"\n'
        f'password = "keychain:data/shop"\nprivacy = "{privacy}"\ntimeout_s = 7\n',
        encoding="utf-8",
    )


async def test_the_password_is_read_from_the_keychain_and_goes_only_to_the_worker(
    paths: GolemPaths, sources: tuple[DataSources, FakeWorker, MemorySecrets]
) -> None:
    found, worker, _store = sources
    _shop_config(paths)
    listed = {info.name: info for info in await found.list(None)}
    shop = listed["shop"]
    assert shop.status == "ready" and shop.kind == "postgres"
    assert [t.name for t in shop.tables or ()] == ["orders"]
    assert shop.in_keychain and shop.timeout_s == 7
    spec = next(s for s in worker.attached if s.name == "shop")
    assert spec.password == PASSWORD and spec.timeout_s == 7
    assert spec.location == "postgres://golem_ro@db.example.com:5432/shop"
    assert PASSWORD not in repr(spec) and PASSWORD not in repr(shop)
    assert PASSWORD not in json.dumps(wire_source(shop).model_dump())
    assert PASSWORD not in paths.config_file.read_text()


async def test_a_missing_keychain_entry_says_so_without_a_password(
    paths: GolemPaths, sources: tuple[DataSources, FakeWorker, MemorySecrets]
) -> None:
    found, worker, store = sources
    store.secrets.clear()
    _shop_config(paths)
    shop = {info.name: info for info in await found.list(None)}["shop"]
    assert shop.status == "error" and "not in the Keychain" in (shop.error or "")
    assert [s.name for s in worker.attached if s.kind == "postgres"] == []


async def test_a_login_that_can_write_gets_a_warning_with_a_how_to(
    paths: GolemPaths, sources: tuple[DataSources, FakeWorker, MemorySecrets]
) -> None:
    found, worker, _store = sources
    worker.can_write = True
    _shop_config(paths)
    shop = {info.name: info for info in await found.list(None)}["shop"]
    assert shop.warning is not None
    assert shop.warning.startswith("This login can change data. golem only reads")
    assert "GRANT SELECT" in shop.warning


async def test_inspect_connects_samples_and_forgets_the_password(
    paths: GolemPaths, sources: tuple[DataSources, FakeWorker, MemorySecrets]
) -> None:
    found, worker, store = sources
    worker.can_write = True
    near = await found.inspect_database(parse_url("postgres://u@localhost/shop"), PASSWORD)
    assert near.kind == "postgres" and near.server_version == "PostgreSQL 17.2"
    assert [t.name for t in near.tables] == ["orders"] and near.tables[0].rows == 3
    assert near.sample == {"orders": [[32.5]]}
    assert near.suggested_name == "shop" and near.suggested_privacy == "local"
    assert near.url == "postgres://u@localhost/shop"
    assert near.warning is not None and "can change data" in near.warning
    assert "limit 20" in worker.queries[0]
    far = await found.inspect_database(parse_url("postgres://u@db.example.com/shop"), None)
    assert far.suggested_privacy == "schema"
    inspected = [s for s in worker.attached if s.kind == "postgres"]
    assert inspected[0].password == PASSWORD and inspected[1].password is None
    assert store.secrets == {"data/shop": PASSWORD}  # inspect stores nothing


async def test_inspect_without_the_extension_asks_for_the_download(tmp_path: Path) -> None:
    bare = GolemPaths(tmp_path / "bare")
    bare.ensure_layout()
    found = DataSources(FakeWorker(bare), bare)
    result = await found.inspect_database(parse_url("mysql://u@h/d"), None)
    assert result.needs_extension == "mysql" and result.tables == ()
    assert "one-time download" in result.notes[0]
    await found.close()


async def test_a_schema_database_source_gives_no_model_any_row(
    paths: GolemPaths, sources: tuple[DataSources, FakeWorker, MemorySecrets]
) -> None:
    found, worker, _store = sources
    _shop_config(paths, "schema")
    call = {"source": "shop", "sql": "select total from orders"}
    for target in (HOSTED, ON_DEVICE):
        context = ToolContext(root=None, data=found.access(None), memory_target=target)
        result = await DATA_QUERY.call(call, context)
        assert "32.5" not in result.output
        assert "not sent to the model" in result.output
        assert result.rows_withheld is True
        assert result.shown is not None and "32.5" in result.shown
    assert worker.queries  # the query ran, for the person's screen


async def test_a_table_of_another_schema_is_quoted_as_two_names(
    paths: GolemPaths, sources: tuple[DataSources, FakeWorker, MemorySecrets]
) -> None:
    found, worker, _store = sources
    inspected = await found.inspect_database(parse_url("postgres://u@localhost/shop"), None)
    assert inspected.tables
    worker_tables = [{"name": "app.invoices", "type": "table", "rows": 2}]

    async def attach(spec: SourceSpec) -> list[dict[str, Any]]:
        return worker_tables

    worker.attach = attach  # type: ignore[method-assign]
    await found.inspect_database(parse_url("postgres://u@localhost/shop"), None)
    assert worker.queries[-1] == 'select * from "app"."invoices" limit 20'


# -- the RPC methods, with the Keychain --------------------------------------------------------


async def _rpc(home: Path, secrets: MemorySecrets) -> tuple[Any, Any, RpcClient]:
    app, task = await start_daemon(home, secrets=secrets)
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


def _add(name: str = "shop", **fields: object) -> dict[str, object]:
    return {
        "name": name,
        "location": "postgres://golem_ro@db.example.com:5432/shop",
        "privacy": "schema",
        "scope": "user",
        **fields,
    }


async def test_add_stores_the_password_in_the_keychain_and_never_in_the_config(
    short_home: Path,
) -> None:
    store = MemorySecrets()
    app, task, client = await _rpc(short_home, store)
    try:
        added = rpc_result(await client.call("data.add", _add(password=PASSWORD)))
        source = cast("dict[str, Any]", added["source"])
        assert source["name"] == "shop" and source["kind"] == "postgres"
        assert source["in_keychain"] is True
        assert store.secrets == {"data/shop": PASSWORD}
        text = (short_home / "config.toml").read_text(encoding="utf-8")
        assert PASSWORD not in text and "s3cr3t" not in text
        assert 'url = "postgres://golem_ro@db.example.com:5432/shop"' in text
        assert 'password = "keychain:data/shop"' in text
        assert PASSWORD not in json.dumps(added)
        everything = json.dumps(rpc_result(await client.call("data.list", {})))
        assert PASSWORD not in everything

        changed = rpc_result(
            await client.call("data.update", {"name": "shop", "password": "new-pw"})
        )
        assert store.secrets["data/shop"] == "new-pw"
        assert "new-pw" not in json.dumps(changed)
        assert "new-pw" not in (short_home / "config.toml").read_text(encoding="utf-8")

        await client.call("data.remove", {"name": "shop"})
        assert store.secrets == {}
        assert "shop" not in (short_home / "config.toml").read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_add_refuses_an_address_that_has_a_password(short_home: Path) -> None:
    store = MemorySecrets()
    app, task, client = await _rpc(short_home, store)
    try:
        reply = await client.call(
            "data.add", _add(location=f"postgres://golem_ro:{PASSWORD}@localhost/shop")
        )
        assert error_code(reply) == INVALID_PARAMS
        assert "s3cr3t" not in json.dumps(reply)
        assert store.secrets == {}
        assert not (short_home / "config.toml").exists() or "shop" not in (
            short_home / "config.toml"
        ).read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_source_keeps_its_password_in_the_users_keychain(
    short_home: Path, tmp_path: Path
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(
        f'trusted_projects = ["{project.resolve()}"]\n', encoding="utf-8"
    )
    store = MemorySecrets()
    app, task, client = await _rpc(short_home, store)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session = str(created["session_id"])
        added = rpc_result(
            await client.call(
                "data.add",
                _add(scope="project", password=PASSWORD, session_id=session),
                timeout=30,
            )
        )
        assert cast("dict[str, Any]", added["source"])["scope"] == "project"
        assert store.secrets == {"data/shop": PASSWORD}
        written = (project / ".golem" / "config.toml").read_text(encoding="utf-8")
        assert PASSWORD not in written and 'password = "keychain:data/shop"' in written
        assert "shop" not in (short_home / "config.toml").read_text(encoding="utf-8")
        await client.call("data.remove", {"name": "shop", "session_id": session})
        assert store.secrets == {}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_inspect_of_a_database_asks_for_the_download_and_refuses_a_bad_host(
    short_home: Path,
) -> None:
    app, task, client = await _rpc(short_home, MemorySecrets())
    try:
        if extension_installed(app.paths.data_extensions_dir, "postgres"):
            pytest.skip("the postgres extension is installed")
        found = rpc_result(
            await client.call(
                "data.inspect",
                {
                    "kind": "postgres",
                    "host": "localhost",
                    "database": "shop",
                    "user": "u",
                    "password": PASSWORD,
                },
                timeout=30,
            )
        )
        assert found["needs_extension"] == "postgres" and found["tables"] == []
        assert found["url"] == "postgres://u@localhost/shop"
        assert found["suggested_name"] == "shop" and found["suggested_privacy"] == "local"
        assert PASSWORD not in json.dumps(found)
        bad = await client.call(
            "data.inspect", {"kind": "mysql", "host": "bad host;x", "database": "d"}
        )
        assert error_code(bad) == INVALID_PARAMS
        none = await client.call("data.inspect", {})
        assert error_code(none) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


# -- live servers -----------------------------------------------------------------------------


def _live(variable: str, kind: str) -> tuple[Source, str] | None:
    """A source on the server named by ``variable`` (a URL, with its password), or None."""
    url = os.environ.get(variable)
    if not url:
        return None
    parts = urlsplit(url)
    password = unquote(parts.password) if parts.password else None
    host = parts.hostname or "localhost"
    port = f":{parts.port}" if parts.port else ""
    user = f"{unquote(parts.username)}@" if parts.username else ""
    bare = f"{parts.scheme}://{user}{host}{port}{parts.path}"
    directory = Path(os.environ.get("GOLEM_TEST_EXTENSION_DIR", "~/.golem/data/extensions"))
    directory = directory.expanduser()
    if not extension_installed(directory, kind):
        return None
    spec = SourceSpec("live", kind, bare, password, timeout_s=2)  # type: ignore[arg-type]
    return Source(spec, Limits(extension_dir=directory)), kind


LIVE = [("GOLEM_TEST_PG_URL", "postgres"), ("GOLEM_TEST_MYSQL_URL", "mysql")]


@pytest.fixture(params=LIVE, ids=[kind for _, kind in LIVE])
def live(request: pytest.FixtureRequest) -> Iterator[Source]:
    variable, kind = request.param
    found = _live(variable, kind)
    if found is None:
        pytest.skip(f"{variable} is not set, or the {kind} extension is not installed")
    yield found[0]
    found[0].close()


def test_live_attach_and_a_query(live: Source) -> None:
    assert live.info.get("version")
    assert live.query("select 1 as one", 10)["rows"] == [[1]]


def test_live_the_server_refuses_a_write(live: Source) -> None:
    kind = live.spec.kind
    function = "postgres_execute" if kind == "postgres" else "mysql_execute"
    cursor = live._connection.cursor()
    with pytest.raises(duckdb.Error):
        cursor.execute(f"call {function}('src', 'create table golem_probe (a int)')")
    cursor.close()


def test_live_a_raw_sql_function_is_refused_by_the_guard(live: Source) -> None:
    kind = live.spec.kind
    with pytest.raises(DataError, match="cannot send SQL"):
        live.query(f"select * from {kind}_query('src', 'select 1')", 10)
    with pytest.raises(DataError, match="cannot send SQL"):
        live.query(f"select * from {kind}_execute('src', 'select 1')", 10)


def test_live_a_slow_query_is_cut_by_the_server(live: Source) -> None:
    kind = live.spec.kind
    if kind == "mysql":
        pytest.skip("a read-only MySQL attach cannot set a server time limit; golem's timeout does")
    sleeper = "select pg_sleep(30)" if kind == "postgres" else "select sleep(30)"
    function = "postgres_query" if kind == "postgres" else "mysql_query"
    cursor = live._connection.cursor()
    started = time.monotonic()
    with contextlib.suppress(duckdb.Error):
        cursor.execute(f"select * from {function}('src', '{sleeper}')").fetchall()
    assert time.monotonic() - started < 20
    cursor.close()
