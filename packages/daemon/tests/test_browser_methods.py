from golem.server.handlers import standard_methods
from golem_protocol.methods import BROWSER_METHODS, DEVICE_METHODS, METHOD_ACCESS

# Methods in the protocol with no daemon handler yet. Remove a name when its handler is added.
NOT_YET_IN_THE_DAEMON: set[str] = set()


def test_every_daemon_method_says_whether_a_browser_may_call_it() -> None:
    declared = set(METHOD_ACCESS) - NOT_YET_IN_THE_DAEMON
    registered = set(standard_methods())
    assert registered == declared, (
        f"in the daemon but not flagged: {sorted(registered - declared)}; "
        f"flagged but not in the daemon: {sorted(declared - registered)}. "
        "Add or remove them in golem_protocol/methods.py."
    )


def test_key_management_stays_out_of_the_browser() -> None:
    assert "auth.set" not in BROWSER_METHODS
    assert "auth.remove" not in BROWSER_METHODS


def test_a_browser_cannot_call_the_gateways_methods() -> None:
    for name in (
        "relay.sign",
        "relay.dh",
        "device.sync",
        "device.pair.request",
        "connection.identify",
    ):
        assert METHOD_ACCESS[name] == "local"
        assert name not in BROWSER_METHODS
        assert name not in DEVICE_METHODS


def test_a_device_never_gets_the_methods_that_edit_trust() -> None:
    for name in DEVICE_METHODS:
        assert not name.startswith(("auth.", "policy.", "mcp.", "config.", "device.")), name
    assert "daemon.shutdown" not in DEVICE_METHODS
    assert DEVICE_METHODS <= BROWSER_METHODS
