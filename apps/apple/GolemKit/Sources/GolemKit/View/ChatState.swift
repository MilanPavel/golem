import Foundation

// One session's transcript, folded from its events. This is the phone's part of
// `packages/view/src/chat-state.ts`: the names are the same, so the two read side by side.
//
// Not ported, because the phone does not draw them yet: the context meter and its notices, the
// model-call costs, the plan and checks, the route, a paid-model question (`route.consent.*`),
// the skills, a model server that is down, the wait on a local model, a file the model is
// still writing, and a helper's own events. A helper's events (`helper.*`, and the legacy events
// that name a `parent_call_id`) change nothing in the lead's transcript here.

public enum ToolStatus: String, Sendable, Equatable {
    case requested, waiting, running, done, failed
}

/// The tool call the run waits on, from `approval.needed`.
public struct PendingApproval {
    public var callId: String
    public var name: String
    public var args: [String: JSONAny]
    /// The rule that asked, such as `built-in default`.
    public var source: String
    /// The change a file tool would make, as a unified diff.
    public var diff: String?
}

/// How a question about a tool call was answered.
public struct ApprovalAnswer {
    public var decision: Decision
    public var rule: String?
    public var edited: Bool
}

/// The question asked about a tool call, and the answer once there is one.
public struct ToolApproval {
    public var source: String
    public var subject: String?
    public var answer: ApprovalAnswer?
}

/// One tool call, drawn under the assistant message that asked for it.
public struct ToolBlock: Identifiable {
    public var callId: String
    public var name: String
    public var args: [String: JSONAny]
    public var status: ToolStatus
    /// One short line from `tool.completed`, such as `42 lines`.
    public var summary: String?
    /// The start of the output, from `tool.completed`.
    public var preview: String?
    public var truncated: Bool?
    /// Where the whole output is, when it was too long for the model.
    public var artifactId: String?
    /// The call ran but did not succeed, such as a command that exited non-zero.
    public var unsuccessful: Bool?
    /// Why it failed, from `tool.failed`.
    public var error: String?
    /// The newest output of a running call, from `tool.output`.
    public var output: String?
    /// The change a file tool would make, as a unified diff.
    public var diff: String?
    /// The question the run asked about this call.
    public var approval: ToolApproval?

    public var id: String { callId }

    public init(callId: String, name: String, args: [String: JSONAny], status: ToolStatus) {
        self.callId = callId
        self.name = name
        self.args = args
        self.status = status
    }
}

public enum ChatRole: String, Sendable, Equatable {
    case user, assistant
}

/// A skill a user message ran.
public struct MessageSkill: Sendable, Equatable {
    public var name: String
    public var args: String?
}

public struct ChatMessage: Identifiable {
    public var id: String
    public var role: ChatRole
    public var text: String
    public var streaming: Bool
    /// The run stopped before the model finished this reply.
    public var interrupted: Bool?
    /// Event time. A completed message uses `message.completed`; a streaming reply `message.started`.
    public var at: String?
    /// The run the message belongs to.
    public var runId: String?
    /// Milliseconds from `run.started` to this finished answer.
    public var durationMs: Int?
    /// What the model thought before it answered.
    public var thinking: String?
    /// Milliseconds the model thought, from `message.completed`.
    public var thinkingMs: Int?
    /// Tool calls this reply asked for, in order.
    public var tools: [ToolBlock]?
    /// Set on a user message that ran a skill. `text` is then the filled-in body.
    public var skill: MessageSkill?
}

public struct ChatState {
    public var messages: [ChatMessage] = []
    public var busy = false
    public var error: String?
    public var notice: String?
    public var runStartedAt: String?
    /// The run in progress.
    public var runId: String?
    /// Set while the run waits for an answer about a tool call.
    public var approval: PendingApproval?
    /// The agent's todo list, from the newest `todos.updated`.
    public var todos: [TodoItem] = []

    public init() {}
}

public let emptyChat = ChatState()

public let LIVE_OUTPUT_CHARS = 4_000

public let SWITCH_HINT = "/model to switch"
public let INSTALL_HINT = "/model to install it or switch"
public let SHUTDOWN_NOTICE = "the daemon stopped, so the run was cancelled"
public let CANCELLED_NOTICE = "cancelled"

/// The banner for a failed run: the message, then how to fix it.
public func failureText(_ data: RunFailedEventData) -> String {
    if data.code == .notInstalled {
        return "\(data.message) \u{b7} \(INSTALL_HINT)"
    }
    var parts = [data.message]
    if let hint = data.hint {
        parts.append(hint)
    }
    if let code = data.code, code != .budgetSpent, code != .localOnly {
        parts.append(SWITCH_HINT)
    }
    return parts.joined(separator: " \u{b7} ")
}

/// The newest message `/fork` can cut at: finished, and not an interrupted reply with no text.
public func forkPoint(_ messages: [ChatMessage]) -> String? {
    messages.last { !$0.streaming && !($0.interrupted == true && $0.text.isEmpty) }?.id
}

/// The one line above an answer that came after thinking: `thinking…`, `thought for 12s`, `thought`.
public func thinkingLine(_ message: ChatMessage) -> String? {
    guard let thinking = message.thinking, !thinking.isEmpty else { return nil }
    if message.streaming && message.text.isEmpty { return "thinking\u{2026}" }
    guard let ms = message.thinkingMs else { return "thought" }
    return "thought for \(thoughtTime(ms))"
}

/// `<1s`, `12s`, then `1m 05s` from a minute on.
private func thoughtTime(_ ms: Int) -> String {
    let seconds = Int((Double(ms) / 1000).rounded())
    if seconds < 1 { return "<1s" }
    if seconds < 60 { return "\(seconds)s" }
    return "\(seconds / 60)m \(String(format: "%02d", seconds % 60))s"
}

/// The chat after one event.
public func reduceChat(_ state: ChatState, _ event: GolemEvent) -> ChatState {
    var next = state
    next.apply(event)
    return next
}

extension ChatState {
    /// Folds one event in. The same rules as `reduceChat` in `packages/view`.
    public mutating func apply(_ event: GolemEvent) {
        switch event {
        case .messageStarted(let event):
            error = nil
            messages.append(ChatMessage(
                id: event.data.messageID, role: .assistant, text: "", streaming: true,
                at: event.ts, runId: runID(of: event)
            ))
        case .messageDelta(let event):
            update(message: event.data.messageID) { $0.text += event.data.text }
        case .messageThinkingDelta(let event):
            update(message: event.data.messageID) { $0.thinking = ($0.thinking ?? "") + event.data.text }
        case .messageCompleted(let event):
            completeMessage(event)
        case .runStarted(let event):
            busy = true
            error = nil
            runStartedAt = event.ts
            runId = event.runID
        case .runCompleted:
            endRun()
        case .runFailed(let event):
            endRun()
            error = failureText(event.data)
        case .runCancelled(let event):
            endRun()
            // A cancel you asked for shows as a hint. One from a daemon shutdown stays in the banner.
            if event.data.reason != .user { notice = SHUTDOWN_NOTICE }
        case .toolRequested(let event):
            guard event.data.parentCallID == nil else { return }
            requestTool(event)
        case .approvalNeeded(let event):
            updateTool(event.data.callID) { tool in
                tool.status = .waiting
                tool.approval = ToolApproval(source: event.data.source, subject: event.data.subject)
                if let diff = event.data.diff, !diff.isEmpty { tool.diff = diff }
            }
            busy = true
            runId = event.runID
            approval = PendingApproval(
                callId: event.data.callID, name: event.data.name, args: event.data.args,
                source: event.data.source, diff: event.data.diff
            )
        case .approvalResolved(let event):
            resolveApproval(event)
        case .todosUpdated(let event):
            todos = event.data.todos.map { TodoItem(id: $0.id, text: $0.text, status: $0.status) }
        case .toolStarted(let event):
            guard event.data.parentCallID == nil else { return }
            updateTool(event.data.callID) { $0.status = .running }
        case .toolOutput(let event):
            updateTool(event.data.callID) { tool in
                tool.output = String(((tool.output ?? "") + event.data.text).suffix(LIVE_OUTPUT_CHARS))
            }
        case .toolCompleted(let event):
            guard event.data.parentCallID == nil else { return }
            updateTool(event.data.callID) { tool in
                tool.output = nil
                tool.status = .done
                tool.summary = event.data.summary
                tool.preview = event.data.preview
                tool.truncated = event.data.truncated == true
                if let artifact = event.data.artifactID { tool.artifactId = artifact }
                if event.data.failed == true { tool.unsuccessful = true }
                if let diff = event.data.diff, !diff.isEmpty { tool.diff = diff }
            }
        case .toolFailed(let event):
            guard event.data.parentCallID == nil else { return }
            updateTool(event.data.callID) { tool in
                tool.output = nil
                tool.status = .failed
                tool.error = event.data.message
            }
        default:
            break
        }
    }

    private func runID(of event: MessageStartedEvent) -> String? {
        let id = event.runID
        return id.isEmpty ? nil : id
    }

    private mutating func endRun() {
        busy = false
        runStartedAt = nil
        runId = nil
        approval = nil
    }

    private mutating func update(message id: String, _ change: (inout ChatMessage) -> Void) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        change(&messages[index])
    }

    private mutating func requestTool(_ event: ToolRequestedEvent) {
        let block = ToolBlock(callId: event.data.callID, name: event.data.name, args: event.data.args, status: .requested)
        update(message: event.data.messageID) { message in
            var tools = (message.tools ?? []).filter { $0.callId != block.callId }
            tools.append(block)
            message.tools = tools
        }
    }

    /// The newest message that holds the call, as `updateTool` in `packages/view` finds it.
    private mutating func updateTool(_ callId: String, _ change: (inout ToolBlock) -> Void) {
        guard let index = messages.lastIndex(where: { $0.tools?.contains { $0.callId == callId } == true }),
              let at = messages[index].tools?.firstIndex(where: { $0.callId == callId })
        else { return }
        change(&messages[index].tools![at])
    }

    private mutating func resolveApproval(_ event: ApprovalResolvedEvent) {
        let edited = event.data.args
        updateTool(event.data.callID) { tool in
            let answer = ApprovalAnswer(decision: event.data.decision, rule: event.data.rule, edited: edited != nil)
            var approval = tool.approval ?? ToolApproval(source: "", subject: event.data.subject)
            approval.answer = answer
            if let edited { tool.args = edited }
            if tool.status == .waiting { tool.status = .requested }
            tool.approval = approval
        }
        approval = nil
    }

    private mutating func completeMessage(_ event: MessageCompletedEvent) {
        let data = event.data
        let role = ChatRole(rawValue: data.role.rawValue) ?? .assistant
        let duration = role == .assistant ? answerDuration(runStartedAt, event.ts) : nil
        let index = messages.firstIndex { $0.id == data.messageID }
        let runId = index.flatMap { messages[$0].runId } ?? (event.runID.isEmpty ? nil : event.runID)
        var next = ChatMessage(
            id: data.messageID, role: role, text: data.text, streaming: false,
            interrupted: data.interrupted == true, at: event.ts, runId: runId, durationMs: duration,
            skill: data.skill.map { MessageSkill(name: $0.name, args: $0.args) }
        )
        guard let index else {
            applyThinking(&next, data.thinking, data.thinkingMS)
            messages.append(next)
            return
        }
        // A reply stopped by a cancel completes with no thinking, so keep what streamed.
        applyThinking(&next, data.thinking ?? messages[index].thinking, data.thinkingMS)
        next.tools = messages[index].tools
        messages[index] = next
    }

    private func applyThinking(_ message: inout ChatMessage, _ thinking: String?, _ ms: Int?) {
        guard let thinking, !thinking.isEmpty else { return }
        message.thinking = thinking
        if let ms { message.thinkingMs = ms }
    }
}

/// Absent when either timestamp is missing or the clock went backwards.
private func answerDuration(_ startedAt: String?, _ finishedAt: String) -> Int? {
    guard let startedAt, let started = parseTime(startedAt), let finished = parseTime(finishedAt), finished >= started else {
        return nil
    }
    return Int(finished - started)
}
