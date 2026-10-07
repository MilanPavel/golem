import json
from pathlib import Path

from golem_protocol.codegen import MODELS, export_schemas, export_version, schema_stem
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR


def test_schema_stem_splits_camel_case() -> None:
    assert schema_stem("Ping") == "ping"
    assert schema_stem("MessageDelta") == "message-delta"


def test_export_schemas_writes_every_model(tmp_path: Path) -> None:
    written = export_schemas(tmp_path)
    assert [path.name for path in written] == [
        f"{schema_stem(model.__name__)}.schema.json" for model in MODELS
    ]


def test_export_schemas_writes_ping(tmp_path: Path) -> None:
    written = export_schemas(tmp_path)
    ping = next(path for path in written if path.name == "ping.schema.json")
    schema = json.loads(ping.read_text(encoding="utf-8"))
    assert schema["title"] == "Ping"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"nonce", "type"}
    properties = schema["properties"]
    assert properties["type"]["const"] == "system.ping"
    assert properties["nonce"]["type"] == "string"


def test_export_version_writes_constants(tmp_path: Path) -> None:
    path = export_version(tmp_path)
    text = path.read_text(encoding="utf-8")
    assert f"export const PROTOCOL_MAJOR = {PROTOCOL_MAJOR};" in text
    assert f"export const PROTOCOL_MINOR = {PROTOCOL_MINOR};" in text
