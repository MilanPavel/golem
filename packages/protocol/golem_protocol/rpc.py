"""JSON-RPC 2.0 envelopes. One object per NDJSON line."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from golem_protocol.commands import (
    AgentRegistryChanged,
    DeviceChanged,
    DevicePairChanged,
    EvalEnded,
    EvalProgress,
    EvalStarted,
    KeychainWait,
    McpLoginDone,
    McpServer,
    McpServerLog,
    McpTestProgress,
    MemoryChanged,
    ModelBenchDone,
    ModelBenchProgress,
    ModelCheckDone,
    ModelCheckProgress,
    ModelOptionsSaved,
    ModelPullDone,
    ModelPullProgress,
    ModelServerStatus,
    OllamaInstallDone,
    OllamaInstallOutput,
    RoutineChanged,
    RoutineFinished,
    RoutineFired,
    RuntimeInstallDone,
    RuntimeInstallOutput,
    SessionSummary,
    SkillRegistryChanged,
    WorkflowRunEvent,
    WorkflowStepEvent,
)
from golem_protocol.events import ChatEvent


def _reject_bool_id(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("id must be a string or integer")
    return value


RpcId = Annotated[str | int, BeforeValidator(_reject_bool_id)]


class RpcRequest(BaseModel):
    """Client → daemon request. ``id`` is required; notifications are not accepted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"]
    method: str = Field(min_length=1)
    params: dict[str, Any] | None = None
    id: RpcId


class RpcErrorBody(BaseModel):
    """JSON-RPC error object."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: int
    message: str
    data: dict[str, Any] | None = None


class RpcSuccess(BaseModel):
    """Successful response. ``result`` is the handler model dumped as JSON."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    result: dict[str, Any]
    id: RpcId


class RpcFailure(BaseModel):
    """Error response. ``id`` is null when the request id could not be read."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    error: RpcErrorBody
    id: RpcId | None = None


class RpcNotification(BaseModel):
    """Server → client event. No ``id``; this is not a response to a request."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["event"] = "event"
    params: ChatEvent


class SessionSummaryNotification(BaseModel):
    """Server → watcher: a session's summary after it changed.

    Sent to connections that called ``session.list`` with ``watch``. It is not
    part of any session's event stream and has no ``seq`` of its own.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["session.summary"] = "session.summary"
    params: SessionSummary


class ModelPullProgressNotification(BaseModel):
    """Server → every connection: a download moved on. Not stored; at most a few per second."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.pull.progress"] = "model.pull.progress"
    params: ModelPullProgress


class ModelPullDoneNotification(BaseModel):
    """Server → every connection: a download ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.pull.done"] = "model.pull.done"
    params: ModelPullDone


class ModelBenchProgressNotification(BaseModel):
    """Server → every connection: one row of a speed run finished. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.bench.progress"] = "model.bench.progress"
    params: ModelBenchProgress


class ModelBenchDoneNotification(BaseModel):
    """Server → every connection: a speed run ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.bench.done"] = "model.bench.done"
    params: ModelBenchDone


class ModelCheckProgressNotification(BaseModel):
    """Server → every connection: one case of a tool-calling check finished. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.check.progress"] = "model.check.progress"
    params: ModelCheckProgress


class ModelCheckDoneNotification(BaseModel):
    """Server → every connection: a tool-calling check ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.check.done"] = "model.check.done"
    params: ModelCheckDone


class ModelOptionsSavedNotification(BaseModel):
    """Server → every connection: the saved options of a model changed. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.options.saved"] = "model.options.saved"
    params: ModelOptionsSaved


class McpServerStatusNotification(BaseModel):
    """Server → every connection: an MCP server started, failed, or changed tools. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["mcp.server.status"] = "mcp.server.status"
    params: McpServer


class McpServerLogNotification(BaseModel):
    """Server → every connection: new log lines of an MCP server, batched. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["mcp.server.log"] = "mcp.server.log"
    params: McpServerLog


class McpTestProgressNotification(BaseModel):
    """Server → every connection: a step of an ``mcp.test`` started or ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["mcp.test.progress"] = "mcp.test.progress"
    params: McpTestProgress


class McpLoginDoneNotification(BaseModel):
    """Server → every connection: a sign-in to an MCP server ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["mcp.login.done"] = "mcp.login.done"
    params: McpLoginDone


class ModelServerStatusNotification(BaseModel):
    """Server → every connection: a local model server started, failed, or stopped. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["model.server.status"] = "model.server.status"
    params: ModelServerStatus


class RuntimeInstallOutputNotification(BaseModel):
    """Server → every connection: output from a running Node or uv install. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["runtime.install.output"] = "runtime.install.output"
    params: RuntimeInstallOutput


class RuntimeInstallDoneNotification(BaseModel):
    """Server → every connection: a Node or uv install ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["runtime.install.done"] = "runtime.install.done"
    params: RuntimeInstallDone


class SkillRegistryChangedNotification(BaseModel):
    """Server → every connection: a skill or ``[skills]`` changed on disk. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["skill.registry.changed"] = "skill.registry.changed"
    params: SkillRegistryChanged


class AgentRegistryChangedNotification(BaseModel):
    """Server → every connection: an agent type file changed on disk. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["agent.registry.changed"] = "agent.registry.changed"
    params: AgentRegistryChanged


class RoutineChangedNotification(BaseModel):
    """Server → every connection: a routine was added, changed or removed. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["routine.changed"] = "routine.changed"
    params: RoutineChanged


class RoutineFiredNotification(BaseModel):
    """Server → every connection: a routine started a run. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["routine.fired"] = "routine.fired"
    params: RoutineFired


class RoutineFinishedNotification(BaseModel):
    """Server → every connection: a routine's run ended, or a firing was skipped. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["routine.finished"] = "routine.finished"
    params: RoutineFinished


class MemoryChangedNotification(BaseModel):
    """Server → every connection: a memory changed. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["memory.changed"] = "memory.changed"
    params: MemoryChanged


class EvalStartedNotification(BaseModel):
    """Server → every connection: a measurement of the helper rules began. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["eval.started"] = "eval.started"
    params: EvalStarted


class EvalProgressNotification(BaseModel):
    """Server → every connection: a run of a measurement began or ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["eval.progress"] = "eval.progress"
    params: EvalProgress


class EvalEndedNotification(BaseModel):
    """Server → every connection: a measurement is no longer running. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["eval.ended"] = "eval.ended"
    params: EvalEnded


class DeviceChangedNotification(BaseModel):
    """Server → every connection: the device registry changed. Not stored.

    The gateway calls ``device.sync`` again (ADR-051).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["device.changed"] = "device.changed"
    params: DeviceChanged = Field(default_factory=DeviceChanged)


class DevicePairChangedNotification(BaseModel):
    """Server → the browser and local connections, never a phone: a pairing moved on. Not stored.

    ``words`` is what the owner compares with the phone (ADR-051).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["device.pair.changed"] = "device.pair.changed"
    params: DevicePairChanged


class WorkflowRunStartedNotification(BaseModel):
    """Server → every connection: ``workflow.run.started``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.run.started"] = "workflow.run.started"
    params: WorkflowRunEvent


class WorkflowRunWaitingNotification(BaseModel):
    """Server → every connection: ``workflow.run.waiting``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.run.waiting"] = "workflow.run.waiting"
    params: WorkflowRunEvent


class WorkflowRunResumedNotification(BaseModel):
    """Server → every connection: ``workflow.run.resumed``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.run.resumed"] = "workflow.run.resumed"
    params: WorkflowRunEvent


class WorkflowRunDoneNotification(BaseModel):
    """Server → every connection: ``workflow.run.done``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.run.done"] = "workflow.run.done"
    params: WorkflowRunEvent


class WorkflowRunFailedNotification(BaseModel):
    """Server → every connection: ``workflow.run.failed``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.run.failed"] = "workflow.run.failed"
    params: WorkflowRunEvent


class WorkflowRunCancelledNotification(BaseModel):
    """Server → every connection: ``workflow.run.cancelled``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.run.cancelled"] = "workflow.run.cancelled"
    params: WorkflowRunEvent


class WorkflowStepStartedNotification(BaseModel):
    """Server → every connection: ``workflow.step.started``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.step.started"] = "workflow.step.started"
    params: WorkflowStepEvent


class WorkflowStepDoneNotification(BaseModel):
    """Server → every connection: ``workflow.step.done``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.step.done"] = "workflow.step.done"
    params: WorkflowStepEvent


class WorkflowStepFailedNotification(BaseModel):
    """Server → every connection: ``workflow.step.failed``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.step.failed"] = "workflow.step.failed"
    params: WorkflowStepEvent


class WorkflowStepWaitingNotification(BaseModel):
    """Server → every connection: ``workflow.step.waiting``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.step.waiting"] = "workflow.step.waiting"
    params: WorkflowStepEvent


class WorkflowStepInDoubtNotification(BaseModel):
    """Server → every connection: ``workflow.step.in_doubt``. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["workflow.step.in_doubt"] = "workflow.step.in_doubt"
    params: WorkflowStepEvent


__all__ = [
    "AgentRegistryChangedNotification",
    "DeviceChangedNotification",
    "DevicePairChangedNotification",
    "EvalEndedNotification",
    "EvalProgressNotification",
    "EvalStartedNotification",
    "KeychainWaitNotification",
    "McpLoginDoneNotification",
    "McpServerLogNotification",
    "McpServerStatusNotification",
    "McpTestProgressNotification",
    "MemoryChangedNotification",
    "ModelBenchDoneNotification",
    "ModelBenchProgressNotification",
    "ModelCheckDoneNotification",
    "ModelCheckProgressNotification",
    "ModelOptionsSavedNotification",
    "ModelPullDoneNotification",
    "ModelPullProgressNotification",
    "ModelServerStatusNotification",
    "RoutineChangedNotification",
    "RoutineFinishedNotification",
    "RoutineFiredNotification",
    "RpcErrorBody",
    "RpcFailure",
    "RpcId",
    "RpcNotification",
    "RpcRequest",
    "RpcSuccess",
    "RuntimeInstallDoneNotification",
    "RuntimeInstallOutputNotification",
    "SessionSummaryNotification",
    "SkillRegistryChangedNotification",
    "WorkflowRunCancelledNotification",
    "WorkflowRunDoneNotification",
    "WorkflowRunFailedNotification",
    "WorkflowRunResumedNotification",
    "WorkflowRunStartedNotification",
    "WorkflowRunWaitingNotification",
    "WorkflowStepDoneNotification",
    "WorkflowStepFailedNotification",
    "WorkflowStepInDoubtNotification",
    "WorkflowStepStartedNotification",
    "WorkflowStepWaitingNotification",
]


class KeychainWaitNotification(BaseModel):
    """Server → every connection: a Keychain read started to wait on macOS, or ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["keychain.wait"] = "keychain.wait"
    params: KeychainWait


class OllamaInstallOutputNotification(BaseModel):
    """Server → every connection: output from a running Ollama install. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["ollama.install.output"] = "ollama.install.output"
    params: OllamaInstallOutput


class OllamaInstallDoneNotification(BaseModel):
    """Server → every connection: an Ollama install ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["ollama.install.done"] = "ollama.install.done"
    params: OllamaInstallDone
