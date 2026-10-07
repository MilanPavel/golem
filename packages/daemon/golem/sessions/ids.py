"""Prefixed ids for sessions, runs, and messages."""

from __future__ import annotations

from uuid import uuid4


def new_id(prefix: str) -> str:
    """Return ``prefix`` plus a random hex id, for example ``s_a1b2…``."""
    return f"{prefix}_{uuid4().hex}"
