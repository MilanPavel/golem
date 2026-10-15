"""End an assistant reply whose run stopped before the model finished.

Cancel and crash recovery both use this. The log gets the reply's
``message.completed`` and the checkpoint gets the same text, so the next turn
sees what the screen showed.
"""

from __future__ import annotations

from golem.graphs.chat import ChatRuntime
from golem.sessions.log import SessionLog
from golem_protocol.events import MessageCompletedData


async def close_reply(
    runtime: ChatRuntime,
    events: SessionLog,
    *,
    session_id: str,
    run_id: str,
    user_message_id: str | None,
    assistant_message_id: str,
    partial: str,
) -> None:
    """Complete ``assistant_message_id`` with ``partial``, marked interrupted.

    A reply the checkpoint already holds was finished by the model. It is
    completed with the checkpoint's text and is not marked.
    """
    finished = await runtime.message_text(session_id, assistant_message_id)
    if finished is None and user_message_id is not None:
        await runtime.record_interrupted(
            session_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            text=partial,
        )
    await events.emit(
        session_id,
        run_id,
        "message.completed",
        MessageCompletedData(
            message_id=assistant_message_id,
            role="assistant",
            text=partial if finished is None else finished,
            interrupted=finished is None,
        ),
    )


__all__ = ["close_reply"]
