"""``data.*``: the wire for data sources."""

import pytest
from pydantic import BaseModel, ValidationError

from golem_protocol.commands import (
    DataAddParams,
    DataChanged,
    DataColumn,
    DataDescribeResult,
    DataInspectResult,
    DataQueryParams,
    DataResult,
    DataResultPageParams,
    DataSavedQuery,
    DataSource,
    DataTable,
)
from golem_protocol.rpc import DataChangedNotification


def round_trip(model: BaseModel) -> None:
    again = type(model).model_validate_json(model.model_dump_json())
    assert again == model


def source() -> DataSource:
    return DataSource(
        name="shop",
        kind="sqlite",
        scope="user",
        location="~/shop.db",
        privacy="local",
        status="ready",
        tables=3,
        rows=120,
    )


def table() -> DataTable:
    return DataTable(
        name="orders",
        rows=2,
        columns=[DataColumn(name="total", type="DECIMAL(10,2)", min="1", max="9", distinct=2)],
    )


def test_source_and_table_models_round_trip() -> None:
    round_trip(source())
    round_trip(table())
    round_trip(DataSavedQuery(name="top", sql="select 1", last_run_at="2026-11-26T10:00:00Z"))


def test_result_models_round_trip() -> None:
    result = DataResult(
        result_id="r1",
        source="shop",
        columns=[DataColumn(name="a", type="TEXT")],
        rows=[["x"], [1], [1.5], [True], [None]],
        total_rows=5,
        elapsed_ms=3,
    )
    round_trip(result)
    round_trip(DataQueryParams(source="shop", sql="select 1"))
    round_trip(DataResultPageParams(result_id="r1", sort_column="a"))
    round_trip(
        DataInspectResult(
            kind="files",
            files=2,
            tables=[table()],
            sample={"orders": [["1", 2]]},
            suggested_name="orders",
            suggested_privacy="local",
            notes=['delimiter ";"'],
        )
    )
    round_trip(DataDescribeResult(source=source(), tables=[table()], sample={}, queries=[]))


def test_add_params_reject_unknown_scope() -> None:
    ok = {"name": "n", "location": "/x", "privacy": "open", "scope": "user"}
    DataAddParams.model_validate(ok)
    with pytest.raises(ValidationError):
        DataAddParams.model_validate({**ok, "scope": "builtin"})


def test_source_carries_no_password_field() -> None:
    assert not [name for name in DataSource.model_fields if "pass" in name or "secret" in name]


def test_changed_notification() -> None:
    note = DataChangedNotification(params=DataChanged(source=None, reason="added"))
    assert note.method == "data.changed"
    round_trip(note)
    with pytest.raises(ValidationError):
        DataChanged.model_validate({"source": "a", "reason": "other"})
