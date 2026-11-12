import shutil
from pathlib import Path

from conftest import make_short_home

from golem.server.app import assert_socket_path_fits


def test_long_root_falls_back_to_a_path_that_fits() -> None:
    long_root = Path("/") / ("w" * 60) / ("agent-" + "a" * 16)
    root = make_short_home(long_root)
    try:
        assert not str(root).startswith(str(long_root))
        assert_socket_path_fits(root / "run" / "golem.sock")
    finally:
        shutil.rmtree(root, ignore_errors=True)
