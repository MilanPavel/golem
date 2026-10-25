"""Write JSON Schema files for the protocol models."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from golem_protocol.commands import (
    ApprovalRespondParams,
    ApprovalRespondResult,
    ArtifactReadParams,
    ArtifactReadResult,
    AuthKeyStatus,
    AuthListParams,
    AuthListResult,
    AuthRemoveParams,
    AuthRemoveResult,
    AuthSetParams,
    AuthSetResult,
    ConfigAllowance,
    ConfigGetParams,
    ConfigGetResult,
    ConfigRule,
    DaemonStatus,
    HelloParams,
    HelloResult,
    InspectMessage,
    ListedModel,
    ListedProvider,
    ListedSkill,
    McpListParams,
    McpListResult,
    McpServer,
    McpServerParams,
    McpSetEnabledParams,
    McpToggleParams,
    McpToggleResult,
    McpToolInfo,
    McpToolsResult,
    MessageSendParams,
    MessageSendResult,
    ModelDeleteParams,
    ModelDeleteResult,
    ModelListParams,
    ModelListResult,
    ModelPriceInfo,
    ModelProbeParams,
    ModelProbeResult,
    ModelPullCancelParams,
    ModelPullCancelResult,
    ModelPullDone,
    ModelPullParams,
    ModelPullProgress,
    ModelPullResult,
    ModelSetDefaultParams,
    ModelSetDefaultResult,
    PingParams,
    PolicyEditResult,
    PolicyRemoveParams,
    PolicyUpdateParams,
    RunCancelParams,
    RunCancelResult,
    SessionAttachParams,
    SessionAttachResult,
    SessionCloseParams,
    SessionCloseResult,
    SessionCreateParams,
    SessionCreateResult,
    SessionDetachParams,
    SessionDetachResult,
    SessionForkParams,
    SessionForkResult,
    SessionInspectParams,
    SessionInspectResult,
    SessionListParams,
    SessionListResult,
    SessionRenameParams,
    SessionRenameResult,
    SessionRevokeParams,
    SessionRevokeResult,
    SessionSetModelParams,
    SessionSetModelResult,
    SessionSummary,
    SkillListParams,
    SkillListResult,
    SkillRegistryChanged,
)
from golem_protocol.events import (
    ApprovalNeededData,
    ApprovalNeededEvent,
    ApprovalResolvedData,
    ApprovalResolvedEvent,
    EmptyEventData,
    ForkedFrom,
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageStartedData,
    MessageStartedEvent,
    ModelSelectedData,
    ModelSelectedEvent,
    Ping,
    RunCancelledData,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedData,
    RunFailedEvent,
    RunStartedEvent,
    SessionAllowance,
    SessionClosedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
    SessionUpdatedData,
    SessionUpdatedEvent,
    Todo,
    TodosUpdatedData,
    TodosUpdatedEvent,
    ToolCompletedData,
    ToolCompletedEvent,
    ToolFailedData,
    ToolFailedEvent,
    ToolOutputData,
    ToolOutputEvent,
    ToolRequestedData,
    ToolRequestedEvent,
    ToolStartedData,
    ToolStartedEvent,
)
from golem_protocol.rpc import (
    McpServerStatusNotification,
    ModelPullDoneNotification,
    ModelPullProgressNotification,
    RpcErrorBody,
    RpcFailure,
    RpcNotification,
    RpcRequest,
    RpcSuccess,
    SessionSummaryNotification,
    SkillRegistryChangedNotification,
)
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

MODELS: tuple[type[BaseModel], ...] = (
    Ping,
    PingParams,
    HelloParams,
    HelloResult,
    DaemonStatus,
    SessionCreateParams,
    SessionCreateResult,
    MessageSendParams,
    MessageSendResult,
    RunCancelParams,
    RunCancelResult,
    SessionInspectParams,
    InspectMessage,
    SessionInspectResult,
    SessionAttachParams,
    SessionAttachResult,
    SessionDetachParams,
    SessionDetachResult,
    SessionListParams,
    SessionSummary,
    SessionListResult,
    SessionCloseParams,
    SessionCloseResult,
    SessionRenameParams,
    SessionRenameResult,
    SessionForkParams,
    SessionForkResult,
    AuthSetParams,
    AuthSetResult,
    AuthRemoveParams,
    AuthRemoveResult,
    AuthListParams,
    AuthKeyStatus,
    AuthListResult,
    ModelListParams,
    ModelPriceInfo,
    ListedModel,
    ListedProvider,
    ModelListResult,
    SessionSetModelParams,
    SessionSetModelResult,
    ModelSetDefaultParams,
    ModelSetDefaultResult,
    ModelSelectedData,
    ModelSelectedEvent,
    ForkedFrom,
    SessionClosedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
    SessionUpdatedData,
    SessionUpdatedEvent,
    MessageStartedData,
    MessageStartedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageCompletedData,
    MessageCompletedEvent,
    EmptyEventData,
    RunStartedEvent,
    RunCompletedEvent,
    RunFailedData,
    RunFailedEvent,
    RunCancelledData,
    RunCancelledEvent,
    ToolRequestedData,
    ToolRequestedEvent,
    ToolStartedData,
    ToolStartedEvent,
    ToolCompletedData,
    ToolCompletedEvent,
    ToolFailedData,
    ToolFailedEvent,
    RpcRequest,
    RpcErrorBody,
    RpcSuccess,
    RpcFailure,
    RpcNotification,
    SessionSummaryNotification,
    ModelProbeParams,
    ModelProbeResult,
    ModelPullParams,
    ModelPullResult,
    ModelPullCancelParams,
    ModelPullCancelResult,
    ModelDeleteParams,
    ModelDeleteResult,
    ModelPullProgress,
    ModelPullDone,
    ModelPullProgressNotification,
    ModelPullDoneNotification,
    ConfigGetParams,
    ConfigRule,
    ConfigGetResult,
    ApprovalNeededData,
    ApprovalNeededEvent,
    ApprovalResolvedData,
    ApprovalResolvedEvent,
    ApprovalRespondParams,
    ApprovalRespondResult,
    ArtifactReadParams,
    ArtifactReadResult,
    ToolOutputData,
    ToolOutputEvent,
    Todo,
    TodosUpdatedData,
    TodosUpdatedEvent,
    SessionAllowance,
    ConfigAllowance,
    PolicyUpdateParams,
    PolicyRemoveParams,
    PolicyEditResult,
    SessionRevokeParams,
    SessionRevokeResult,
    McpListParams,
    McpServer,
    McpListResult,
    McpServerStatusNotification,
    McpToggleParams,
    McpToggleResult,
    McpServerParams,
    McpToolInfo,
    McpToolsResult,
    McpSetEnabledParams,
    SkillRegistryChanged,
    SkillRegistryChangedNotification,
    SkillListParams,
    ListedSkill,
    SkillListResult,
)


def schema_stem(name: str) -> str:
    """Turn ``MessageDelta`` into ``message-delta``."""
    chars: list[str] = []
    for char in name:
        if char.isupper() and chars:
            chars.append("-")
        chars.append(char.lower())
    return "".join(chars)


def default_gen_dir() -> Path:
    """``packages/protocol/gen``, derived from this source file."""
    return Path(__file__).resolve().parent.parent / "gen"


def export_schemas(directory: Path) -> list[Path]:
    """Write one JSON Schema file per protocol model. Returns the paths written."""
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.schema.json"):
        stale.unlink()
    written: list[Path] = []
    for model in MODELS:
        schema = model.model_json_schema()
        path = directory / f"{schema_stem(model.__name__)}.schema.json"
        path.write_text(
            json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        written.append(path)
    return written


def export_version(directory: Path) -> Path:
    """Write ``version.ts`` from :mod:`golem_protocol.version`.

    ``just gen`` deletes ``*.ts`` before json2ts runs, then calls this so the
    constants are regenerated with the schemas.
    """
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "version.ts"
    path.write_text(
        "/* Generated by `just gen` from golem_protocol.version. Do not edit. */\n"
        "\n"
        f"export const PROTOCOL_MAJOR = {PROTOCOL_MAJOR};\n"
        f"export const PROTOCOL_MINOR = {PROTOCOL_MINOR};\n",
        encoding="utf-8",
    )
    return path


def main() -> None:
    export_schemas(default_gen_dir())


if __name__ == "__main__":
    main()
