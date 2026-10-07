import pytest
from pydantic import ValidationError

from golem_protocol.events import Ping
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR


def test_ping_round_trip() -> None:
    ping = Ping(type="system.ping", nonce="abc")
    restored = Ping.model_validate_json(ping.model_dump_json())
    assert restored == ping


def test_ping_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        Ping.model_validate({"type": "system.ping", "nonce": "abc", "extra": 1})


def test_protocol_version_is_draft_v1() -> None:
    assert PROTOCOL_MAJOR == 1
    assert PROTOCOL_MINOR == 1
