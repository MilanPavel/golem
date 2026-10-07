def test_daemon_environment_can_import_protocol() -> None:
    from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

    assert (PROTOCOL_MAJOR, PROTOCOL_MINOR) == (1, 1)
