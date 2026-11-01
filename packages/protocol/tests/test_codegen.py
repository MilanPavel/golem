import json
from pathlib import Path

from golem_protocol.codegen import (
    MODELS,
    export_browser_methods,
    export_schemas,
    export_version,
    schema_stem,
)
from golem_protocol.methods import BROWSER_METHODS, METHOD_ACCESS
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


def test_export_browser_methods_lists_each_method_once(tmp_path: Path) -> None:
    path = export_browser_methods(tmp_path)
    text = path.read_text(encoding="utf-8")
    browser, local = text.split("LOCAL_ONLY_METHODS")
    for name in BROWSER_METHODS:
        assert f'"{name}",' in browser
    assert '"auth.set",' in local
    assert '"auth.remove",' in local
    assert '"auth.set"' not in browser
    assert text.count('",') == len(METHOD_ACCESS)


def test_export_browser_methods_is_sorted_and_deterministic(tmp_path: Path) -> None:
    first = export_browser_methods(tmp_path).read_text(encoding="utf-8")
    second = export_browser_methods(tmp_path).read_text(encoding="utf-8")
    assert first == second
    names = [line.strip(' ",') for line in first.split("LOCAL_ONLY_METHODS")[0].splitlines()[3:-3]]
    assert names == sorted(BROWSER_METHODS)
