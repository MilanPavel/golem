"""Which daemon methods a browser or a paired phone may call through the gateways.

Every daemon method is listed here, in the order the daemon registers them.
``auth.set`` and ``auth.remove`` are ``"local"``: a model provider's API key
typed into a page would sit in browser memory, so key management stays in the
terminal. MCP servers, their tokens, and ``config.toml`` may be managed from a
page, with the daemon refusing edits that move a secret or widen trust
(ADR-037). The gateway's allowlist is generated from this table (``just gen``
writes ``gen/browser-methods.ts``), and a daemon test fails for any method that
is missing here. ADR-028 and ADR-037 are the reference.

``"device"`` is the level between: the browser and a paired phone may both call the method
(``just gen`` writes ``gen/device-methods.ts``). A device never gets ``auth.*``, anything that
edits ``config.toml``, rules, MCP servers, trust or runtimes, ``mcp.call``, ``daemon.shutdown``,
or any ``device.*`` method. A method is ``"device"`` only when someone lists it so (ADR-051).

A browser may edit user skills, and project skills only in a trusted project. The
``_protected`` skill methods are ``"local"`` and skip that check (ADR-054).
"""

from collections.abc import Mapping
from typing import Final, Literal

Access = Literal["device", "browser", "local"]

METHOD_ACCESS: Final[Mapping[str, Access]] = {
    "hello": "device",
    "daemon.status": "device",
    "ping": "device",
    "session.create": "device",
    "config.get": "browser",
    "policy.update": "browser",
    "policy.remove": "browser",
    "session.revoke": "browser",
    "session.attach": "device",
    "session.detach": "device",
    "session.list": "device",
    "session.fork": "device",
    "session.close": "device",
    "session.rename": "device",
    "message.send": "device",
    "approval.respond": "device",
    "route.consent.answer": "browser",
    "run.cancel": "device",
    "artifact.read": "device",
    "session.inspect": "device",
    "changes.list": "browser",
    "changes.diff": "browser",
    "changes.revert": "browser",
    "file.read": "browser",
    "file.list": "browser",
    "changes.commit": "browser",
    "changes.commit_info": "browser",
    "changes.suggest_message": "browser",
    "cost.get": "browser",
    "eval.routing": "local",
    "notifications.get": "browser",
    "notifications.set": "browser",
    "routing.get": "browser",
    "routing.set": "browser",
    "trace.get": "device",
    "trace.span": "device",
    "auth.set": "local",
    "auth.remove": "local",
    "auth.list": "browser",
    "model.list": "device",
    "mcp.list": "browser",
    "mcp.enable": "browser",
    "mcp.disable": "browser",
    "mcp.tools": "browser",
    "mcp.restart": "browser",
    "mcp.login": "browser",
    "mcp.logout": "browser",
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
    "skill.read": "browser",
    "skill.write": "browser",
    "skill.write_protected": "local",
    "skill.create": "browser",
    "skill.create_protected": "local",
    "skill.set_disabled": "browser",
    "routine.list": "browser",
    "routine.get": "browser",
    "routine.update": "browser",
    "routine.remove": "browser",
    "routine.run": "browser",
    "routine.preview": "browser",
    "run.list": "device",
    "session.set_skills": "browser",
    "model.probe": "browser",
    "model.pull": "browser",
    "model.pull_cancel": "browser",
    "model.delete": "browser",
    "model.score_reset": "browser",
    "model.check": "local",
    "model.bench": "local",
    "model.set_default": "browser",
    "permissions.set_mode": "browser",
    "session.set_model": "browser",
    "session.set_options": "browser",
    "session.set_mode": "browser",
    "session.set_checks": "browser",
    "session.set_route": "browser",
    "session.set_plan": "browser",
    "session.compact": "browser",
    "model.options.get": "browser",
    "model.options.set": "browser",
    "setup.status": "browser",
    "ollama.install": "browser",
    "ollama.install_cancel": "browser",
    "ollama.start": "browser",
    "fs.list_dirs": "browser",
    "git.info": "browser",
    "git.branches": "browser",
    "fs.choose_folder": "browser",
    "notify.test": "browser",
    "memory.list": "browser",
    "memory.get": "browser",
    "memory.write": "browser",
    "memory.update": "browser",
    "memory.delete": "browser",
    "memory.export": "browser",
    "memory.settings": "browser",
    "agents.list": "browser",
    "agents.get": "browser",
    "agents.set_wish": "browser",
    "agents.keep": "browser",
    "agents.save": "browser",
    "agents.copy": "browser",
    "agents.delete": "browser",
    "helper.stop": "browser",
    "relay.sign": "local",
    "relay.dh": "local",
    "device.sync": "local",
    "device.pair.request": "local",
    "device.list": "browser",
    "device.pair.begin": "browser",
    "device.pair.confirm": "browser",
    "device.rename": "browser",
    "device.revoke": "browser",
    "connection.identify": "local",
}

BROWSER_METHODS: Final[frozenset[str]] = frozenset(
    name for name, access in METHOD_ACCESS.items() if access in ("browser", "device")
)
"""What a browser may call: the ``browser`` and the ``device`` methods."""

DEVICE_METHODS: Final[frozenset[str]] = frozenset(
    name for name, access in METHOD_ACCESS.items() if access == "device"
)
"""What a paired phone may call."""
