"""The TLS context for every outbound HTTPS call, backed by the operating system's trust store.

httpx verifies against the ``certifi`` bundle by default, which does not hold the
root certificate of a company proxy that inspects TLS (Zscaler, for one), so a
fetch behind one fails with ``CERTIFICATE_VERIFY_FAILED``. ``truststore`` asks
the OS instead (the macOS keychain, the Windows store, the system CA bundle on
Linux), the same place ``curl`` and the browser look.
"""

from __future__ import annotations

import ssl
from functools import lru_cache

import truststore


@lru_cache(maxsize=1)
def tls_context() -> ssl.SSLContext:
    """The shared client context, built once. Pass it as ``verify=`` to an httpx client."""
    return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
