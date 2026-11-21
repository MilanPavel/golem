"""The Mac's relay keys: made on first use, kept in the secret store, never returned."""

from __future__ import annotations

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, x25519

from golem.relay_keys import (
    IDENTITY,
    NOISE,
    SIGN_PREFIX,
    RelayKeyError,
    RelayKeys,
    b64,
    check_public_key,
    device_id,
    unb64,
    verify,
)
from golem.secrets import MemorySecrets

MESSAGE = SIGN_PREFIX + b"macexample.relay.test" + b"nonce"


def test_the_keys_are_made_on_first_use_and_then_kept() -> None:
    store = MemorySecrets()
    keys = RelayKeys(store)
    assert store.secrets == {}
    first = keys.mac_key()
    assert set(store.secrets) == {IDENTITY}
    noise = keys.noise_key()
    assert set(store.secrets) == {IDENTITY, NOISE}
    again = RelayKeys(store)
    assert again.mac_key() == first
    assert again.noise_key() == noise


def test_the_stored_forms_are_pkcs8_der_and_32_raw_bytes() -> None:
    store = MemorySecrets()
    keys = RelayKeys(store)
    keys.mac_key()
    keys.noise_key()
    der = unb64(store.secrets[IDENTITY])
    loaded = serialization.load_der_private_key(der, password=None)
    assert isinstance(loaded, ec.EllipticCurvePrivateKey)
    assert isinstance(loaded.curve, ec.SECP256R1)
    assert len(unb64(store.secrets[NOISE])) == 32


def test_the_public_keys_have_the_sizes_of_the_record() -> None:
    keys = RelayKeys(MemorySecrets())
    mac = keys.mac_key()
    assert len(mac) == 65
    assert mac[0] == 4
    assert len(keys.noise_key()) == 32
    assert len(unb64(keys.room())) == 32


def test_a_relay_message_is_signed_and_the_signature_verifies() -> None:
    keys = RelayKeys(MemorySecrets())
    sig = keys.sign(MESSAGE)
    assert len(sig) == 64
    assert verify(keys.mac_key(), MESSAGE, sig)
    assert not verify(keys.mac_key(), MESSAGE + b"x", sig)
    assert not verify(RelayKeys(MemorySecrets()).mac_key(), MESSAGE, sig)


@pytest.mark.parametrize("message", [b"", b"golem-relay-v1", b"golem-auth-v1" + b"h" * 32, b"x"])
def test_any_other_message_is_refused(message: bytes) -> None:
    with pytest.raises(RelayKeyError):
        RelayKeys(MemorySecrets()).sign(message)


def test_dh_agrees_with_an_x25519_done_from_the_other_side() -> None:
    keys = RelayKeys(MemorySecrets())
    phone = x25519.X25519PrivateKey.generate()
    phone_public = phone.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    shared = keys.dh(phone_public)
    mac_public = x25519.X25519PublicKey.from_public_bytes(keys.noise_key())
    assert shared == phone.exchange(mac_public)
    assert len(shared) == 32


def test_dh_refuses_an_all_zero_result() -> None:
    keys = RelayKeys(MemorySecrets())
    with pytest.raises(RelayKeyError):
        keys.dh(bytes(32))


def test_a_stored_key_that_is_not_ours_is_an_error_not_a_new_key() -> None:
    store = MemorySecrets({IDENTITY: b64(b"junk"), NOISE: b64(b"short")})
    keys = RelayKeys(store)
    with pytest.raises(RelayKeyError):
        keys.mac_key()
    with pytest.raises(RelayKeyError):
        keys.noise_key()
    assert store.secrets[IDENTITY] == b64(b"junk")


def test_device_ids_and_public_keys() -> None:
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    assert check_public_key(public) == public
    assert len(device_id(public)) == 32
    with pytest.raises(ValueError, match="65 bytes"):
        check_public_key(public[:33])
    with pytest.raises(ValueError):
        check_public_key(b"\x04" + bytes(64))


def test_base64url_has_no_padding() -> None:
    assert b64(b"\xfb\xff") == "-_8"
    assert unb64("-_8") == b"\xfb\xff"
    with pytest.raises(ValueError):
        unb64("a")
