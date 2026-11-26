"""The statement check: one statement, and it reads."""

from __future__ import annotations

import pytest

from golem.data.guard import EMPTY, ONE_STATEMENT, ONLY_READS, refusal


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
        "attach 'x.db'",
        "install sqlite",
        "load sqlite",
        "set threads = 1",
        "pragma version",
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
