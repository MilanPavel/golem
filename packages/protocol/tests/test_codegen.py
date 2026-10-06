import json
from pathlib import Path

from golem_protocol.codegen import export_schemas, schema_stem


def test_schema_stem_splits_camel_case() -> None:
    assert schema_stem("Ping") == "ping"
    assert schema_stem("MessageDelta") == "message-delta"


def test_export_schemas_writes_ping(tmp_path: Path) -> None:
    written = export_schemas(tmp_path)
    assert [path.name for path in written] == ["ping.schema.json"]
    schema = json.loads(written[0].read_text(encoding="utf-8"))
    assert schema["title"] == "Ping"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"nonce", "type"}
    properties = schema["properties"]
    assert properties["type"]["const"] == "system.ping"
    assert properties["nonce"]["type"] == "string"
