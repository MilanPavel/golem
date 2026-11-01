from golem.server.handlers import standard_methods
from golem_protocol.methods import BROWSER_METHODS, METHOD_ACCESS


def test_every_daemon_method_says_whether_a_browser_may_call_it() -> None:
    declared = set(METHOD_ACCESS)
    registered = set(standard_methods())
    assert registered == declared, (
        f"in the daemon but not flagged: {sorted(registered - declared)}; "
        f"flagged but not in the daemon: {sorted(declared - registered)}. "
        "Add or remove them in golem_protocol/methods.py."
    )


def test_key_management_stays_out_of_the_browser() -> None:
    assert "auth.set" not in BROWSER_METHODS
    assert "auth.remove" not in BROWSER_METHODS
