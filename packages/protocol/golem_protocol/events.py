"""Server → client events.

Phase 0 ships ``Ping`` so schema generation has a real model.
The event catalog from the plan is modeled in Phase 1.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Ping(BaseModel):
    """Dummy heartbeat event. Proves Pydantic → JSON Schema → TypeScript."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["system.ping"]
    nonce: str
