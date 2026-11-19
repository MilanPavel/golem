"""The ``[memory] private = true`` flag of a project's ``.golem/config.toml``.

Like ``[routing] local_only``, a project file can only make things more private: the flag
makes the project's notes local, and ``false`` changes nothing. The rest of ``[memory]`` is
ignored in a project file (see ``golem.config``).
"""

from __future__ import annotations

from golem.models.project_privacy import project_flag


def project_memory_private(cwd: str | None) -> bool:
    """Whether ``cwd`` or a folder above it has a project file with ``[memory] private = true``."""
    return project_flag(cwd, "memory", "private")


__all__ = ["project_memory_private"]
