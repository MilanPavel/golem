"""Server → client events.

``Ping`` is the result body of the ``ping`` command. The rest of the event
catalog arrives with the sessions that emit it.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Ping(BaseModel):
    """Dummy heartbeat event. Proves Pydantic → JSON Schema → TypeScript."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["system.ping"]
    nonce: str
