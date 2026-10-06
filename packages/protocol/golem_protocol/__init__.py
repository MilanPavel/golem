"""Protocol models shared by the daemon and its clients."""

from golem_protocol.events import Ping
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

__all__ = ["PROTOCOL_MAJOR", "PROTOCOL_MINOR", "Ping"]
