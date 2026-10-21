"""Golem daemon."""

from __future__ import annotations

import importlib

_DEV_VERSION = "0.0.0-dev"


def _read_version() -> str:
    """The git tag stamped into ``_build.py`` by ``just dist``, or ``0.0.0-dev``."""
    try:
        module = importlib.import_module("golem._build")
    except ImportError:
        return _DEV_VERSION
    version = getattr(module, "VERSION", "")
    if isinstance(version, str) and version != "":
        return version
    return _DEV_VERSION


__version__ = _read_version()
