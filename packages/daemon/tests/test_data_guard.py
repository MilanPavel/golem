"""The statement check: one statement, and it reads."""

from __future__ import annotations

import pytest

from golem.data.guard import CONNECTION, EMPTY, ONE_STATEMENT, ONLY_READS, refusal


@pytest.mark.parametrize(
    "sql",
    [
        "select 1",
        "SELECT * FROM t WHERE a = 1;",
        "with a as (select 1 as x) select * from a",
        "from range(3)",
        "describe select 1",
        "summarize select 1",
        "select 'a;b'",
    ],
)
def test_reading_queries_pass(sql: str) -> None:
    assert refusal(sql) is None


@pytest.mark.parametrize(
    "sql",
    [
        "delete from t",
        "insert into t values (1)",
        "update t set a = 1",
        "copy (select 1) to '/tmp/x.csv'",
        "install sqlite",
        "load sqlite",
        "create table t (a int)",
        "drop table t",
        "call pragma_version()",
        "explain select 1",
        "export database '/tmp/x'",
    ],
)
def test_writing_and_settings_statements_are_refused(sql: str) -> None:
    assert refusal(sql) == ONLY_READS


def test_two_statements_are_refused_even_when_both_read() -> None:
    assert refusal("select 1; select 2") == ONE_STATEMENT
    assert refusal("select 1; delete from t") == ONE_STATEMENT


@pytest.mark.parametrize("sql", ["", "   ", ";"])
def test_an_empty_query_is_refused(sql: str) -> None:
    assert refusal(sql) == EMPTY


def test_a_query_that_does_not_parse_says_so() -> None:
    reason = refusal("selec 1")
    assert reason is not None
    assert reason.startswith("The query does not parse")


def test_pivot_is_refused() -> None:
    assert refusal("pivot t on a") is not None


@pytest.mark.parametrize(
    "sql",
    [
        "attach 'x.db'",
        "ATTACH 'host=h dbname=d' AS other (TYPE postgres)",
        "detach src",
        "use other",
        "set threads = 1",
        "reset threads",
        "pragma version",
        "  -- hello\n attach 'x.db'",
        "/* c */ set memory_limit = '1GB'",
    ],
)
def test_connection_statements_get_their_own_sentence(sql: str) -> None:
    assert refusal(sql) == CONNECTION


@pytest.mark.parametrize(
    "sql",
    [
        "select * from postgres_query('src', 'select 1')",
        "SELECT * FROM POSTGRES_QUERY('src', 'select 1')",
        "select * from main.\"mysql_query\"('src', 'select 1')",
        "select * from postgres_scan('host=h', 'public', 't')",
        "select postgres_execute('src', 'delete from t')",
        "call postgres_execute('src', 'delete from t')",
        "with x as (select * from mysql_query('src', 'select 1')) select * from x",
        "select * from t where a in (select a from postgres_query('src', 'select 1'))",
        "select * from mysql_execute('src', 'drop table t')",
        "select * from postgres_attach('host=h')",
    ],
)
def test_functions_that_send_sql_to_a_server_are_refused(sql: str) -> None:
    reason = refusal(sql)
    assert reason is not None
    assert reason != ONLY_READS or "execute" in sql
    assert "server" in reason or reason == ONLY_READS


def test_the_refusal_names_the_function_and_keeps_text_in_strings_allowed() -> None:
    reason = refusal("select * from postgres_query('src', 'select 1')")
    assert reason is not None and "postgres_query" in reason
    assert refusal("select 'postgres_query' as word") is None
