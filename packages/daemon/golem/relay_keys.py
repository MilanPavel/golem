"""The Mac's two relay keys, held by the daemon (ADR-051).

``relay/identity`` is an ECDSA P-256 key, stored as PKCS#8 DER. ``relay/noise`` is an
X25519 key, stored as its 32 raw bytes. The secret store holds printable text only, so both
are written as base64url without padding. Each is made on first use. The daemon returns the
public halves, a signature, or a shared secret, and never a private key. Nothing here logs a
key, a message, or a result.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import threading

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, x25519
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)

from golem.secrets import SecretStore

IDENTITY = "relay/identity"
NOISE = "relay/noise"
SIGN_PREFIX = b"golem-relay-v1\x00"
"""The daemon signs only a message that starts with these bytes, so the gateway cannot use
the Mac's key for anything else."""


class RelayKeyError(Exception):
    """A key could not be used, or a request is one the daemon refuses."""


def b64(data: bytes) -> str:
    """``data`` as base64url without padding, the encoding of bytes in JSON."""
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64(text: str) -> bytes:
    """The bytes of base64url text without padding. Raises :class:`ValueError`."""
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("not base64url") from exc


def device_id(public_key: bytes) -> str:
    """The id of a device: the first 16 bytes of the SHA-256 of its public key, in hex."""
    return hashlib.sha256(public_key).digest()[:16].hex()


def check_public_key(public_key: bytes) -> bytes:
    """``public_key`` when it is a valid uncompressed P-256 point (65 bytes)."""
    if len(public_key) != 65 or public_key[0] != 4:
        raise ValueError("a device key is 65 bytes, uncompressed")
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_key)
    return public_key


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """Whether ``signature`` (64 bytes, ``r || s``) is ``public_key``'s over ``message``."""
    if len(signature) != 64:
        return False
    try:
        key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_key)
        der = encode_dss_signature(
            int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
        )
        key.verify(der, message, ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        return False
    return True


class RelayKeys:
    """The Mac's relay keys in a secret store. Blocking: call it from a thread."""

    def __init__(self, store: SecretStore) -> None:
        self._store = store
        self._lock = threading.Lock()

    def _identity(self) -> ec.EllipticCurvePrivateKey:
        with self._lock:
            stored = self._store.get(IDENTITY)
            if stored is None:
                key = ec.generate_private_key(ec.SECP256R1())
                der = key.private_bytes(
                    serialization.Encoding.DER,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
                self._store.set(IDENTITY, b64(der))
                return key
        try:
            loaded = serialization.load_der_private_key(unb64(stored), password=None)
        except (ValueError, TypeError) as exc:
            raise RelayKeyError(f"{IDENTITY} in the Keychain is not a P-256 key") from exc
        if not isinstance(loaded, ec.EllipticCurvePrivateKey) or not isinstance(
            loaded.curve, ec.SECP256R1
        ):
            raise RelayKeyError(f"{IDENTITY} in the Keychain is not a P-256 key")
        return loaded

    def _noise(self) -> x25519.X25519PrivateKey:
        with self._lock:
            stored = self._store.get(NOISE)
            if stored is None:
                key = x25519.X25519PrivateKey.generate()
                raw = key.private_bytes(
                    serialization.Encoding.Raw,
                    serialization.PrivateFormat.Raw,
                    serialization.NoEncryption(),
                )
                self._store.set(NOISE, b64(raw))
                return key
        try:
            return x25519.X25519PrivateKey.from_private_bytes(unb64(stored))
        except ValueError as exc:
            raise RelayKeyError(f"{NOISE} in the Keychain is not an X25519 key") from exc

    def mac_key(self) -> bytes:
        """The public signing key, 65 bytes uncompressed."""
        return (
            self._identity()
            .public_key()
            .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        )

    def room(self) -> str:
        """The room id: the SHA-256 of :meth:`mac_key`, base64url."""
        return b64(hashlib.sha256(self.mac_key()).digest())

    def noise_key(self) -> bytes:
        """The public Noise key, 32 bytes."""
        return (
            self._noise()
            .public_key()
            .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        )

    def sign(self, message: bytes) -> bytes:
        """The 64-byte signature of ``message``, which must start with :data:`SIGN_PREFIX`."""
        if not message.startswith(SIGN_PREFIX):
            raise RelayKeyError("the relay key signs only a golem-relay-v1 message")
        der = self._identity().sign(message, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")

    def dh(self, public_key: bytes) -> bytes:
        """The X25519 shared secret with ``public_key``. Refused when it is all zeros."""
        try:
            shared = self._noise().exchange(x25519.X25519PublicKey.from_public_bytes(public_key))
        except ValueError as exc:
            raise RelayKeyError("the Diffie-Hellman result is not usable") from exc
        if not any(shared):
            raise RelayKeyError("the Diffie-Hellman result is all zeros")
        return shared
