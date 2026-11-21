import Foundation

// The Inbox: everything the sessions wait for, with the words each item shows. This is
// `packages/view/src/inbox.ts`. The input is typed by its shape, as the wire's session summary has
// it, so a summary of any of the generated types converts with `InboxSession(summary:)`.

/// A helper that asks, in a lead's `pending_items`.
public struct InboxPendingHelper: Codable, Sendable, Equatable {
    public var sessionId: String
    public var agent: String
    public var label: String?
    public var index: Int

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id", agent, label, index
    }

    public init(sessionId: String, agent: String, label: String? = nil, index: Int) {
        self.sessionId = sessionId
        self.agent = agent
        self.label = label
        self.index = index
    }
}

/// What a session waits for, as its summary carries it.
public struct InboxPending: Codable, Equatable {
    public var kind: PendingItemKind
    public var since: String
    public var callId: String?
    public var name: String?
    public var subject: String?
    public var source: String?
    public var added: Int?
    public var removed: Int?
    public var alternatives: Int?
    /// The helper that asks, for an item in a lead's `pending_items`.
    public var helper: InboxPendingHelper?
    /// How many helpers ask this same question; the item is listed once.
    public var count: Int?
    /// For a helper's paid question: what goes to the paid model, and what does not.
    public var sent: [String]?
    public var notSent: [String]?

    enum CodingKeys: String, CodingKey {
        case kind, since, name, subject, source, added, removed, alternatives, helper, count, sent
        case callId = "call_id", notSent = "not_sent"
    }

    public init(
        kind: PendingItemKind, since: String, callId: String? = nil, name: String? = nil, subject: String? = nil,
        source: String? = nil, added: Int? = nil, removed: Int? = nil, alternatives: Int? = nil,
        helper: InboxPendingHelper? = nil, count: Int? = nil, sent: [String]? = nil, notSent: [String]? = nil
    ) {
        self.kind = kind
        self.since = since
        self.callId = callId
        self.name = name
        self.subject = subject
        self.source = source
        self.added = added
        self.removed = removed
        self.alternatives = alternatives
        self.helper = helper
        self.count = count
        self.sent = sent
        self.notSent = notSent
    }
}

/// The part of a session summary the Inbox and the session list read.
public struct InboxSession: Codable, Equatable, Identifiable {
    public var sessionId: String
    public var title: String?
    /// `idle`, `running`, `waiting` or `closed`.
    public var status: String
    public var pending: InboxPending?
    /// Everything the session waits for, a lead's helpers included. An older daemon leaves it out.
    public var pendingItems: [InboxPending]?
    /// Set for a helper session: its lead's id. An older daemon leaves it out.
    public var parentSessionId: String?
    public var updatedAt: String?
    public var createdAt: String?
    public var cwd: String?
    public var step: String?
    public var waitLine: String?
    public var helpersRunning: Int?
    public var helpersWaiting: Int?

    public var id: String { sessionId }

    enum CodingKeys: String, CodingKey {
        case title, status, pending, step, cwd
        case sessionId = "session_id", pendingItems = "pending_items", parentSessionId = "parent_session_id"
        case updatedAt = "updated_at", createdAt = "created_at", waitLine = "wait_line"
        case helpersRunning = "helpers_running", helpersWaiting = "helpers_waiting"
    }

    public init(
        sessionId: String, title: String? = nil, status: String, pending: InboxPending? = nil,
        pendingItems: [InboxPending]? = nil, parentSessionId: String? = nil, updatedAt: String? = nil
    ) {
        self.sessionId = sessionId
        self.title = title
        self.status = status
        self.pending = pending
        self.pendingItems = pendingItems
        self.parentSessionId = parentSessionId
        self.updatedAt = updatedAt
    }

    /// A summary of any generated type (`session.list`, the summary notification): the same keys.
    public init<Summary: Encodable>(summary: Summary) throws {
        self = try JSONDecoder().decode(InboxSession.self, from: JSONEncoder().encode(summary))
    }
}

/// The items of a summary: `pending_items` when the daemon sends it, else `[pending]`, else none.
public func pendingItemsOf(_ session: InboxSession) -> [InboxPending] {
    if let items = session.pendingItems, !items.isEmpty { return items }
    return session.pending.map { [$0] } ?? []
}

/// The helper behind an item, with the words that name it.
public struct InboxHelper: Sendable, Equatable {
    public var sessionId: String
    public var agent: String
    public var label: String?
    public var index: Int
    /// `worker · upgrade httpx`, or just the agent when there is no label.
    public var name: String
}

/// One question that waits for the user. `age` is text only; ticking it live is the screen's job.
public struct InboxItem: Equatable, Identifiable {
    public var sessionId: String
    public var sessionTitle: String
    public var kind: PendingItemKind
    /// The tool call to answer; nil for a consent.
    public var callId: String?
    public var headline: String
    /// The rule that asked; nil for a consent.
    public var source: String?
    /// The time the question was asked, as the daemon wrote it.
    public var since: String
    public var age: String
    public var added: Int?
    public var removed: Int?
    /// The helper that asks, for an item in a lead's list; nil for the session's own item.
    public var helper: InboxHelper?
    /// How many helpers ask this same question (1 for an item of one asker).
    public var count: Int
    /// Where the answer goes: the helper's session for a helper's item, else `sessionId`.
    public var answerSessionId: String
    /// For a paid question: what goes to the paid model; empty when the daemon does not say.
    public var sent: [String]
    /// For a paid question: what does not go.
    public var notSent: [String]

    public var id: String { "\(sessionId)/\(callId ?? "consent")/\(since)" }
}

/// One lead and what it and its helpers wait for.
public struct InboxGroup: Equatable, Identifiable {
    public var sessionId: String
    public var sessionTitle: String
    /// The items, oldest first.
    public var items: [InboxItem]
    /// How many askers wait: an item counts once per helper that asks it.
    public var waiting: Int

    public var id: String { sessionId }
}

private let minute = 60_000.0
private let hour = 60 * minute
private let day = 24 * hour
private let subjectLimit = 80
private let untitled = "Untitled"

/// How long ago: `now` under a minute, then `4m`, `2h`, `3d`. Empty when the time is unreadable.
func ageText(_ since: String, now: Double) -> String {
    guard let then = parseTime(since) else { return "" }
    let age = now - then
    if age < minute { return "now" }
    if age < hour { return "\(Int(age / minute))m" }
    if age < day { return "\(Int(age / hour))h" }
    return "\(Int(age / day))d"
}

/// The subject as one line, cut at 80 characters; `{}` and `[]` name nothing.
private func oneLine(_ subject: String?) -> String {
    guard let subject else { return "" }
    let line = subject.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    let bare = subject.filter { !$0.isWhitespace }
    if bare == "{}" || bare == "[]" { return "" }
    return line.count > subjectLimit ? "\(line.prefix(subjectLimit))\u{2026}" : line
}

/// The last part of a path.
private func fileName(_ path: String) -> String {
    var trimmed = Substring(path)
    while trimmed.hasSuffix("/") { trimmed = trimmed.dropLast() }
    let name = trimmed.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
    return name.isEmpty ? path : name
}

private func headline(_ pending: InboxPending) -> String {
    if pending.kind == .consent { return "Use a paid model for this message?" }
    let name = pending.name ?? ""
    let subject = oneLine(pending.subject)
    if name == "edit_file" && !subject.isEmpty {
        let counts = pending.added != nil && pending.removed != nil ? " +\(pending.added!) \u{2212}\(pending.removed!)" : ""
        return "Edit `\(fileName(subject))`\(counts)"
    }
    if name == "write_file" && !subject.isEmpty {
        return "Write `\(fileName(subject))`\(pending.added.map { " +\($0)" } ?? "")"
    }
    if name == "shell" && !subject.isEmpty { return "Run `\(subject)`" }
    let tool = name.isEmpty ? "a tool" : "`\(name)`"
    return subject.isEmpty ? "Use \(tool)" : "Use \(tool) on `\(subject)`"
}

private func helperOf(_ pending: InboxPending) -> InboxHelper? {
    guard let helper = pending.helper else { return nil }
    let trimmed = helper.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let label = trimmed.isEmpty ? nil : trimmed
    return InboxHelper(
        sessionId: helper.sessionId, agent: helper.agent, label: label, index: helper.index,
        name: label.map { "\(helper.agent) \u{b7} \($0)" } ?? helper.agent
    )
}

/// `2 helpers` for a count of 2 or more, else nil.
public func inboxHelperCountWords(_ count: Int) -> String? {
    count >= 2 ? "\(count) helpers" : nil
}

/// `5 helpers ask this` for a count of 2 or more, else nil.
public func inboxHelperAskWords(_ count: Int) -> String? {
    count >= 2 ? "\(count) helpers ask this" : nil
}

/// Oldest first by `since`, ties by session id. A time that does not read falls back to the text.
private func isBefore(_ a: InboxItem, _ b: InboxItem) -> Bool? {
    if let ta = parseTime(a.since), let tb = parseTime(b.since), ta != tb { return ta < tb }
    if a.since != b.since { return a.since < b.since }
    if a.sessionId != b.sessionId { return a.sessionId < b.sessionId }
    return nil
}

/// The items that wait, oldest first by `since` (ties by session id), one for each pending item: a lead's own
/// and its helpers'. Closed sessions are left out, and so is a helper session whose lead is listed, because
/// the lead's `pending_items` already has its item.
public func inboxItems(_ sessions: [InboxSession], now: Double) -> [InboxItem] {
    let ids = Set(sessions.map(\.sessionId))
    var items: [InboxItem] = []
    for session in sessions {
        if session.status == "closed" { continue }
        if let lead = session.parentSessionId, ids.contains(lead) { continue }
        for pending in pendingItemsOf(session) {
            let approval = pending.kind == .approval
            let helper = helperOf(pending)
            let title = session.title.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
            items.append(InboxItem(
                sessionId: session.sessionId,
                sessionTitle: title ?? untitled,
                kind: pending.kind,
                callId: approval ? pending.callId : nil,
                headline: headline(pending),
                source: approval ? pending.source : nil,
                since: pending.since,
                age: ageText(pending.since, now: now),
                added: approval ? pending.added : nil,
                removed: approval ? pending.removed : nil,
                helper: helper,
                count: max(1, pending.count ?? 1),
                answerSessionId: helper?.sessionId ?? session.sessionId,
                sent: approval ? [] : pending.sent ?? [],
                notSent: approval ? [] : pending.notSent ?? []
            ))
        }
    }
    // A stable sort: items of one session with the same `since` keep their order.
    return items.enumerated().sorted { left, right in
        isBefore(left.element, right.element) ?? (left.offset < right.offset)
    }.map(\.element)
}

/// The items of `inboxItems` by lead, the lead with the oldest item first.
public func inboxGroups(_ sessions: [InboxSession], now: Double) -> [InboxGroup] {
    var groups: [InboxGroup] = []
    for item in inboxItems(sessions, now: now) {
        if let at = groups.firstIndex(where: { $0.sessionId == item.sessionId }) {
            groups[at].items.append(item)
            groups[at].waiting += item.count
        } else {
            groups.append(InboxGroup(sessionId: item.sessionId, sessionTitle: item.sessionTitle, items: [item], waiting: item.count))
        }
    }
    return groups
}

/// How many askers need you, for a badge: one for each item, and for a question several helpers ask,
/// one for each helper (the count).
public func inboxCount(_ items: [InboxItem]) -> Int {
    items.reduce(0) { $0 + $1.count }
}
