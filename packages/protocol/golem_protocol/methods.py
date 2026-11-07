"""Which daemon methods a browser may call through the web gateway.

Every daemon method is listed here, in the order the daemon registers them.
``auth.set`` and ``auth.remove`` are ``"local"``: a model provider's API key
typed into a page would sit in browser memory, so key management stays in the
terminal. MCP servers, their tokens, and ``config.toml`` may be managed from a
page, with the daemon refusing edits that move a secret or widen trust
(ADR-037). The gateway's allowlist is generated from this table (``just gen``
writes ``gen/browser-methods.ts``), and a daemon test fails for any method that
is missing here. ADR-028 and ADR-037 are the reference.
"""

from collections.abc import Mapping
from typing import Final, Literal

Access = Literal["browser", "local"]

METHOD_ACCESS: Final[Mapping[str, Access]] = {
    "hello": "browser",
    "daemon.status": "browser",
    "ping": "browser",
    "session.create": "browser",
    "config.get": "browser",
    "policy.update": "browser",
    "policy.remove": "browser",
    "session.revoke": "browser",
    "session.attach": "browser",
    "session.detach": "browser",
    "session.list": "browser",
    "session.fork": "browser",
    "session.close": "browser",
    "session.rename": "browser",
    "message.send": "browser",
    "approval.respond": "browser",
    "run.cancel": "browser",
    "artifact.read": "browser",
    "session.inspect": "browser",
    "auth.set": "local",
    "auth.remove": "local",
    "auth.list": "browser",
    "model.list": "browser",
    "mcp.list": "browser",
    "mcp.enable": "browser",
    "mcp.disable": "browser",
    "mcp.tools": "browser",
    "mcp.restart": "browser",
    "mcp.set_enabled": "browser",
    "mcp.add": "browser",
    "mcp.remove": "browser",
    "mcp.get": "browser",
    "mcp.test": "browser",
    "mcp.catalog": "browser",
    "mcp.import.scan": "browser",
    "mcp.import.apply": "browser",
    "runtime.install": "browser",
    "runtime.install_cancel": "browser",
    "mcp.logs": "browser",
    "mcp.call": "browser",
    "mcp.update": "browser",
    "config.raw.get": "browser",
    "config.raw.set": "browser",
    "config.raw.set_protected": "local",
    "skill.list": "browser",
    "session.set_skills": "browser",
    "model.probe": "browser",
    "model.pull": "browser",
    "model.pull_cancel": "browser",
    "model.delete": "browser",
    "model.set_default": "browser",
    "session.set_model": "browser",
    "setup.status": "browser",
    "ollama.install": "browser",
    "ollama.install_cancel": "browser",
    "ollama.start": "browser",
}

BROWSER_METHODS: Final[frozenset[str]] = frozenset(
    name for name, access in METHOD_ACCESS.items() if access == "browser"
)
