import Foundation
import Observation

// The observable state a screen reads. Each model folds what the connection delivers with the
// pure functions beside it, so a screen holds no logic of its own. They are main-actor types:
// the connection's streams are read with `follow`, which runs on the caller's actor.

/// One session's transcript: its messages, tool steps, todos, and the approval it waits on.
@MainActor @Observable
public final class TranscriptModel {
    public let sessionID: String
    public private(set) var chat = ChatState()

    public init(sessionID: String) {
        self.sessionID = sessionID
    }

    /// The transcript in turns: a user message, or the steps that answered it.
    public var turns: [Turn] { groupTurns(chat.messages) }

    /// What golem is doing in this session, for a given connection.
    public func golemState(connected: Bool) -> GolemState {
        GolemKit.golemState(connected: connected, phase: chat.phase, error: chat.error != nil)
    }

    /// Folds in an event of this session. Another session's event, and one with no session, change nothing.
    public func apply(_ event: GolemEvent) {
        guard event.sessionID == sessionID else { return }
        chat.apply(event)
    }

    /// Reads events until the stream ends.
    public func follow(_ events: AsyncStream<GolemEvent>) async {
        for await event in events {
            apply(event)
        }
    }
}

/// The session list: every session the Mac knows, as its summaries say.
@MainActor @Observable
public final class SessionListModel {
    public private(set) var sessions: [InboxSession] = []

    public init() {}

    /// Replaces the list, as after `session.list`.
    public func replace(with sessions: [InboxSession]) {
        self.sessions = sessions
    }

    /// Adds a session or replaces the one with its id, as a summary notification does.
    public func update(_ session: InboxSession) {
        if let index = sessions.firstIndex(where: { $0.sessionId == session.sessionId }) {
            sessions[index] = session
        } else {
            sessions.append(session)
        }
    }

    public func remove(sessionID: String) {
        sessions.removeAll { $0.sessionId == sessionID }
    }

    /// Reads `session.list` from the Mac and replaces the list with it.
    public func refresh(from connection: Connection) async throws {
        let listed = try await connection.listSessions()
        replace(with: try listed.map { try InboxSession(summary: $0) })
    }

    /// The sessions by when they last changed.
    public func timeGroups(now: Double, calendar: Calendar = .current) -> [TimeGroup<InboxSession>] {
        groupByTime(sessions, now: now, calendar: calendar) { $0.updatedAt }
    }
}

/// Routine and workflow runs, as `run.list` sends them.
@MainActor @Observable
public final class RunsModel {
    public private(set) var runs: [RunLike] = []

    public init() {}

    public func replace(with runs: [RunLike]) {
        self.runs = runs
    }

    /// Reads `run.list` from the Mac and replaces the runs with it.
    public func refresh(from connection: Connection) async throws {
        let listed = try await connection.listRuns()
        replace(with: try listed.map { try RunLike(info: $0) })
    }

    public func groups(now: Double, calendar: Calendar = .current) -> [RunGroup] {
        runGroups(runs, now: now, calendar: calendar)
    }

    public var needsYouCount: Int { GolemKit.needsYouCount(runs) }
}

/// The Inbox: what needs you, what is running, and what finished today.
public struct Inbox {
    /// Approvals and paid-model questions of the sessions, oldest first.
    public var needsYou: [InboxItem]
    /// Runs that wait for a person but have no approval in the session list: a review. No event names
    /// one yet, so this holds a waiting run whose question is not in a session's pending items.
    public var reviews: [RunLike]
    /// Queued and running runs, newest start first.
    public var running: [RunLike]
    /// Runs that ended and started today, newest start first.
    public var today: [RunLike]

    /// How many askers need you, for the badge.
    public var needsYouCount: Int { inboxCount(needsYou) + reviews.count }
}

/// The Inbox, and the approvals in it, from the session list and the runs.
@MainActor @Observable
public final class InboxModel {
    public let sessions: SessionListModel
    public let runs: RunsModel

    public init(sessions: SessionListModel, runs: RunsModel) {
        self.sessions = sessions
        self.runs = runs
    }

    public func inbox(now: Double, calendar: Calendar = .current) -> Inbox {
        let items = inboxItems(sessions.sessions, now: now)
        let asking = Set(items.map(\.sessionId))
        let groups = runGroups(runs.runs, now: now, calendar: calendar)
        func group(_ label: RunGroupLabel) -> [RunLike] { groups.first { $0.label == label }?.items ?? [] }
        return Inbox(
            needsYou: items,
            reviews: group(.needsYou).filter { !asking.contains($0.sessionId) },
            running: group(.running),
            today: group(.today)
        )
    }

    /// The number on the app icon: the same count as the web sidebar's "N need you", one for each asker
    /// of the sessions' pending items. A waiting run with no pending item in a session is not counted.
    public func badgeCount(now: Double) -> Int {
        inboxCount(inboxItems(sessions.sessions, now: now))
    }

    /// The tool calls that wait for an answer, oldest first.
    public func pendingApprovals(now: Double) -> [InboxItem] {
        inboxItems(sessions.sessions, now: now).filter { $0.kind == .approval }
    }
}
