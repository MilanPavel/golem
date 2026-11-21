"""The gateway's relay methods and ``device.changed`` (ADR-051, The wire in detail)."""

import pytest
from pydantic import ValidationError

from golem_protocol.commands import (
    ConnectionIdentifyParams,
    ConnectionIdentifyResult,
    DeviceSyncParams,
    DeviceSyncResult,
    RelayDhParams,
    RelayDhResult,
    RelaySignParams,
    RelaySignResult,
)
from golem_protocol.events import ApprovalResolvedData
from golem_protocol.rpc import DeviceChangedNotification

KEY32 = "A" * 43
KEY65 = "B" * 87
SIG64 = "C" * 86
DEVICE = "0123456789abcdef0123456789abcdef"


def test_sign_and_dh_round_trip_and_refuse_bad_bytes() -> None:
    sign = RelaySignParams(message="Z29sZW0tcmVsYXktdjEA")
    assert RelaySignParams.model_validate_json(sign.model_dump_json()) == sign
    assert RelaySignResult(sig=SIG64).sig == SIG64
    assert RelayDhParams(public_key=KEY32).public_key == KEY32
    assert RelayDhResult(shared=KEY32).shared == KEY32
    for bad in ("", "has space", "pad=", "a+b/c"):
        with pytest.raises(ValidationError):
            RelaySignParams(message=bad)
    with pytest.raises(ValidationError):
        RelayDhParams(public_key="A" * 42)
    with pytest.raises(ValidationError):
        RelaySignResult(sig="C" * 85)


def test_sync_has_the_shape_of_the_record() -> None:
    DeviceSyncParams.model_validate({})
    with pytest.raises(ValidationError):
        DeviceSyncParams.model_validate({"x": 1})
    result = DeviceSyncResult.model_validate(
        {
            "url": None,
            "room": KEY32,
            "mac_key": KEY65,
            "noise_key": KEY32,
            "seq": 3,
            "devices": [{"id": DEVICE, "key": KEY65}],
            "pairs": [{"slot": "abc", "exp": 1_700_000_000}],
        }
    )
    assert DeviceSyncResult.model_validate_json(result.model_dump_json()) == result
    with pytest.raises(ValidationError):
        DeviceSyncResult.model_validate(
            {**result.model_dump(), "devices": [{"id": "XY", "key": KEY65}]}
        )


def test_identify_takes_a_hex_id_and_answers_with_nothing() -> None:
    assert ConnectionIdentifyParams(device=DEVICE).device == DEVICE
    assert ConnectionIdentifyResult().model_dump() == {}
    for bad in ("", DEVICE.upper(), DEVICE[:-1], DEVICE + "0"):
        with pytest.raises(ValidationError):
            ConnectionIdentifyParams(device=bad)


def test_device_changed_is_a_notification_without_an_id() -> None:
    note = DeviceChangedNotification()
    assert note.method == "device.changed"
    assert DeviceChangedNotification.model_validate_json(note.model_dump_json()) == note
    assert '"id"' not in note.model_dump_json()


def test_a_resolved_approval_may_name_the_device() -> None:
    base = {"call_id": "c1", "name": "shell", "decision": "allow"}
    assert ApprovalResolvedData.model_validate(base).device is None
    assert ApprovalResolvedData.model_validate({**base, "device": DEVICE}).device == DEVICE
    with pytest.raises(ValidationError):
        ApprovalResolvedData.model_validate({**base, "device": "iPhone"})
