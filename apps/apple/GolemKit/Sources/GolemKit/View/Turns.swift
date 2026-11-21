import Foundation

/// One user message, or the run of assistant steps that answered it.
public enum Turn {
    case user(id: String, message: ChatMessage)
    case golem(id: String, steps: [ChatMessage])

    public var id: String {
        switch self {
        case .user(let id, _), .golem(let id, _): return id
        }
    }
}

/// Groups the transcript into turns. Messages carry no run id, so consecutive assistant messages
/// (no user message between them) are one turn: a run with tool calls is one message per model step.
public func groupTurns(_ messages: [ChatMessage]) -> [Turn] {
    var turns: [Turn] = []
    for message in messages {
        if message.role == .user {
            turns.append(.user(id: message.id, message: message))
            continue
        }
        if case .golem(let id, var steps)? = turns.last {
            steps.append(message)
            turns[turns.count - 1] = .golem(id: id, steps: steps)
        } else {
            turns.append(.golem(id: message.id, steps: [message]))
        }
    }
    return turns
}

/// The footer of a finished turn: the last step's time (counted from the run start) and every step's tools.
public struct TurnFooter: Sendable, Equatable {
    public var durationMs: Int?
    public var tools: Int
}

/// Nil while streaming. The token and cost totals of `turnFooter` in `packages/view` are not ported.
public func turnFooter(_ steps: [ChatMessage]) -> TurnFooter? {
    if steps.contains(where: \.streaming) { return nil }
    let tools = steps.reduce(0) { $0 + ($1.tools?.count ?? 0) }
    return TurnFooter(durationMs: steps.last?.durationMs, tools: tools)
}
