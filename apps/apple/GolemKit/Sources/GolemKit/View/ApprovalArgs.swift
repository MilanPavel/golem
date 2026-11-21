import Foundation

public enum ParsedArgs {
    case ok([String: JSONAny])
    case failed(String)
}

/// The text as one JSON object, or why it is not.
public func parseArgs(_ text: String) -> ParsedArgs {
    let value: Any
    do {
        value = try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
    } catch {
        return .failed("not JSON: \(error.localizedDescription)")
    }
    guard value is [String: Any], let args = try? JSONDecoder().decode([String: JSONAny].self, from: Data(text.utf8)) else {
        return .failed("the arguments must be one JSON object")
    }
    return .ok(args)
}

/// The same JSON with its keys in order, so two sets of arguments compare by what they say.
private func canonical(_ args: [String: JSONAny]) -> Data? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try? encoder.encode(args)
}

/// The edited arguments, or nil when they are the call's own and nothing was edited. Unlike the
/// TypeScript, a change of key order alone is not an edit.
public func editedArgs(original: [String: JSONAny], args: [String: JSONAny]) -> [String: JSONAny]? {
    canonical(original) == canonical(args) ? nil : args
}

/// One way to answer an item: the key, the words, and what goes on the wire.
public struct ApprovalAnswerOption: Equatable {
    public enum ID: String, Sendable {
        case once, session, always, helper
        case allHelpers = "all-helpers"
        case deny
    }

    public var id: ID
    /// Lower case; "enter" for Enter.
    public var key: String
    public var shown: String
    public var label: String
    public var decision: Decision
    /// "batch" for all helpers of the call; nil otherwise.
    public var scope: String?
}

/// What the answers depend on: whether a helper asks, and how many helpers are not done.
public struct ApprovalAnswerContext: Sendable {
    public var helper: Bool
    /// How many helpers ask this same question.
    public var count: Int?
    /// How many helpers of the lead are not done, when the caller knows.
    public var siblings: Int?

    public init(helper: Bool, count: Int? = nil, siblings: Int? = nil) {
        self.helper = helper
        self.count = count
        self.siblings = siblings
    }
}

/// The answers for one item, in the order they show. A lead's own item: once, this session, always, deny.
/// A helper's item: once, this helper (`allow_session` in the helper's session), all helpers (`allow` with
/// scope "batch"; only when at least two helpers are in play), deny. "Always" stays in Tool rules for a helper.
public func approvalAnswerOptions(_ context: ApprovalAnswerContext) -> [ApprovalAnswerOption] {
    let once = ApprovalAnswerOption(id: .once, key: "enter", shown: "\u{21b5}", label: "Allow once", decision: .allow)
    let deny = ApprovalAnswerOption(id: .deny, key: "d", shown: "D", label: "Deny", decision: .deny)
    if !context.helper {
        return [
            once,
            ApprovalAnswerOption(id: .session, key: "s", shown: "S", label: "For this session", decision: .allowSession),
            ApprovalAnswerOption(id: .always, key: "w", shown: "W", label: "Always", decision: .allowAlways),
            deny,
        ]
    }
    var options = [
        once,
        ApprovalAnswerOption(id: .helper, key: "h", shown: "H", label: "For this helper", decision: .allowSession),
    ]
    let many = max(context.count ?? 1, context.siblings ?? 1)
    if many >= 2 {
        options.append(ApprovalAnswerOption(
            id: .allHelpers, key: "t", shown: "T", label: "For all \(many) helpers", decision: .allow, scope: "batch"
        ))
    }
    options.append(deny)
    return options
}

/// The option a key stands for, or nil.
public func approvalAnswerForKey(_ options: [ApprovalAnswerOption], key: String) -> ApprovalAnswerOption? {
    let lower = key.lowercased()
    return options.first { $0.key == lower }
}

/// The answers an Inbox item offers: none for a consent or an item without a call id.
public func inboxAnswerOptions(_ item: InboxItem, siblings: Int? = nil) -> [ApprovalAnswerOption] {
    guard item.kind == .approval, item.callId != nil else { return [] }
    return approvalAnswerOptions(ApprovalAnswerContext(helper: item.helper != nil, count: item.count, siblings: siblings))
}

/// Where an answer goes: the helper's session for a helper's item, with the item's call id. Nil without a call id.
public func answerTarget(_ item: InboxItem) -> (sessionId: String, callId: String)? {
    guard let callId = item.callId else { return nil }
    return (item.answerSessionId, callId)
}
