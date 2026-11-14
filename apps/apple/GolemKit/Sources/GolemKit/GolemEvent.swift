import Foundation

/// One event from a session's stream, by its `type`.
///
/// A type this build does not know decodes to `.unknown`, so an older app keeps
/// working against a newer daemon (the protocol grows by minor versions).
public enum GolemEvent {
    case approvalNeeded(ApprovalNeededEvent)
    case approvalResolved(ApprovalResolvedEvent)
    case messageCompleted(MessageCompletedEvent)
    case messageDelta(MessageDeltaEvent)
    case messageStarted(MessageStartedEvent)
    case messageThinkingDelta(MessageThinkingDeltaEvent)
    case modelCallCompleted(ModelCallCompletedEvent)
    case modelCallStarted(ModelCallStartedEvent)
    case modelOptionsChanged(ModelOptionsChangedEvent)
    case modelSelected(ModelSelectedEvent)
    case runCancelled(RunCancelledEvent)
    case runCompleted(RunCompletedEvent)
    case runFailed(RunFailedEvent)
    case runStarted(RunStartedEvent)
    case sessionClosed(SessionClosedEvent)
    case sessionCreated(SessionCreatedEvent)
    case sessionModeChanged(SessionModeChangedEvent)
    case sessionUpdated(SessionUpdatedEvent)
    case skillActivated(SkillActivatedEvent)
    case skillDeactivated(SkillDeactivatedEvent)
    case skillSkipped(SkillSkippedEvent)
    case todosUpdated(TodosUpdatedEvent)
    case toolCompleted(ToolCompletedEvent)
    case toolFailed(ToolFailedEvent)
    case toolOutput(ToolOutputEvent)
    case toolRequested(ToolRequestedEvent)
    case toolStarted(ToolStartedEvent)
    case unknown(UnknownEvent)
}

/// An event whose `type` this build does not know.
public struct UnknownEvent: Codable {
    public let type: String
    public let seq: Int?
    public let sessionID: String?
    public let runID: String?
    public let ts: String?

    enum CodingKeys: String, CodingKey {
        case type, seq, ts
        case sessionID = "session_id"
        case runID = "run_id"
    }
}

extension GolemEvent: Decodable {
    private enum Probe: String, CodingKey { case type }

    public init(from decoder: Decoder) throws {
        let type = try decoder.container(keyedBy: Probe.self).decode(String.self, forKey: .type)
        switch type {
        case "approval.needed":
            self = .approvalNeeded(try ApprovalNeededEvent(from: decoder))
        case "approval.resolved":
            self = .approvalResolved(try ApprovalResolvedEvent(from: decoder))
        case "message.completed":
            self = .messageCompleted(try MessageCompletedEvent(from: decoder))
        case "message.delta":
            self = .messageDelta(try MessageDeltaEvent(from: decoder))
        case "message.started":
            self = .messageStarted(try MessageStartedEvent(from: decoder))
        case "message.thinking.delta":
            self = .messageThinkingDelta(try MessageThinkingDeltaEvent(from: decoder))
        case "model.call.completed":
            self = .modelCallCompleted(try ModelCallCompletedEvent(from: decoder))
        case "model.call.started":
            self = .modelCallStarted(try ModelCallStartedEvent(from: decoder))
        case "model.options.changed":
            self = .modelOptionsChanged(try ModelOptionsChangedEvent(from: decoder))
        case "model.selected":
            self = .modelSelected(try ModelSelectedEvent(from: decoder))
        case "run.cancelled":
            self = .runCancelled(try RunCancelledEvent(from: decoder))
        case "run.completed":
            self = .runCompleted(try RunCompletedEvent(from: decoder))
        case "run.failed":
            self = .runFailed(try RunFailedEvent(from: decoder))
        case "run.started":
            self = .runStarted(try RunStartedEvent(from: decoder))
        case "session.closed":
            self = .sessionClosed(try SessionClosedEvent(from: decoder))
        case "session.created":
            self = .sessionCreated(try SessionCreatedEvent(from: decoder))
        case "session.mode.changed":
            self = .sessionModeChanged(try SessionModeChangedEvent(from: decoder))
        case "session.updated":
            self = .sessionUpdated(try SessionUpdatedEvent(from: decoder))
        case "skill.activated":
            self = .skillActivated(try SkillActivatedEvent(from: decoder))
        case "skill.deactivated":
            self = .skillDeactivated(try SkillDeactivatedEvent(from: decoder))
        case "skill.skipped":
            self = .skillSkipped(try SkillSkippedEvent(from: decoder))
        case "todos.updated":
            self = .todosUpdated(try TodosUpdatedEvent(from: decoder))
        case "tool.completed":
            self = .toolCompleted(try ToolCompletedEvent(from: decoder))
        case "tool.failed":
            self = .toolFailed(try ToolFailedEvent(from: decoder))
        case "tool.output":
            self = .toolOutput(try ToolOutputEvent(from: decoder))
        case "tool.requested":
            self = .toolRequested(try ToolRequestedEvent(from: decoder))
        case "tool.started":
            self = .toolStarted(try ToolStartedEvent(from: decoder))
        default:
            self = .unknown(try UnknownEvent(from: decoder))
        }
    }

    /// The event's `seq`, which a client resumes from.
    public var seq: Int? {
        switch self {
        case .approvalNeeded(let event): return event.seq
        case .approvalResolved(let event): return event.seq
        case .messageCompleted(let event): return event.seq
        case .messageDelta(let event): return event.seq
        case .messageStarted(let event): return event.seq
        case .messageThinkingDelta(let event): return event.seq
        case .modelCallCompleted(let event): return event.seq
        case .modelCallStarted(let event): return event.seq
        case .modelOptionsChanged(let event): return event.seq
        case .modelSelected(let event): return event.seq
        case .runCancelled(let event): return event.seq
        case .runCompleted(let event): return event.seq
        case .runFailed(let event): return event.seq
        case .runStarted(let event): return event.seq
        case .sessionClosed(let event): return event.seq
        case .sessionCreated(let event): return event.seq
        case .sessionModeChanged(let event): return event.seq
        case .sessionUpdated(let event): return event.seq
        case .skillActivated(let event): return event.seq
        case .skillDeactivated(let event): return event.seq
        case .skillSkipped(let event): return event.seq
        case .todosUpdated(let event): return event.seq
        case .toolCompleted(let event): return event.seq
        case .toolFailed(let event): return event.seq
        case .toolOutput(let event): return event.seq
        case .toolRequested(let event): return event.seq
        case .toolStarted(let event): return event.seq
        case .unknown(let event): return event.seq
        }
    }
}
