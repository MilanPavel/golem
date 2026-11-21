import Foundation
import Observation

// Approval answers given while the Mac cannot be reached (ADR-051, "The Mac asleep, and answers sent
// late"). `Connection`'s outbox keeps and delivers them; this is what the screens show about them.
// Both are in memory: a killed app loses what waits.

/// One answer that waits to go, or that the Mac has dealt with.
public struct PendingAnswer: Equatable {
    public enum Status: Equatable, Sendable {
        case waiting
        /// The Mac refused it because the question was answered elsewhere first.
        case answeredOnMac
        /// The Mac refused it for another reason.
        case failed(String)
    }

    public var sessionId: String
    public var callId: String
    public var decision: Decision
    public var status: Status
    var outboxId: UUID

    /// "Allow once", "Always allow" or "Deny", as the Inbox row says it.
    public var decisionText: String {
        switch decision {
        case .allow: "Allow once"
        case .allowAlways: "Always allow"
        case .allowSession: "Allow for this session"
        case .deny: "Deny"
        }
    }

    /// The line under an Inbox row.
    public var rowText: String {
        switch status {
        case .waiting: "Waiting to send \u{b7} \(decisionText)"
        case .answeredOnMac: ApprovalSheetModel.answeredElsewhereText
        case .failed(let message): "Not sent: \(message)"
        }
    }
}

@MainActor @Observable
public final class PendingAnswers {
    /// By call id.
    public private(set) var answers: [String: PendingAnswer] = [:]
    @ObservationIgnored private var early: [UUID: OutboxOutcome.Result] = [:]
    @ObservationIgnored private var follower: Task<Void, Never>?

    public init() {}

    /// How many answers wait to be sent.
    public var waitingCount: Int { answers.values.filter { $0.status == .waiting }.count }

    public func answer(for callId: String) -> PendingAnswer? { answers[callId] }

    public func isWaiting(callId: String) -> Bool { answers[callId]?.status == .waiting }

    /// Queues an answer in the connection's outbox and remembers it. A call that already waits is not
    /// queued twice.
    public func queue(
        sessionId: String, callId: String, decision: Decision, on connection: Connection
    ) async throws {
        guard !isWaiting(callId: callId) else { return }
        let params = ApprovalRespondParams(args: nil, callID: callId, decision: decision, scope: nil, sessionID: sessionId)
        let id = try await connection.enqueue("approval.respond", params)
        // The link may have come back and the Mac may have said something before this line ran.
        var status = PendingAnswer.Status.waiting
        if let result = early.removeValue(forKey: id) {
            if case .delivered = result { return }
            status = Self.status(of: result)
        }
        answers[callId] = PendingAnswer(
            sessionId: sessionId, callId: callId, decision: decision, status: status, outboxId: id)
    }

    /// Reads what the Mac said about each queued answer, until the stream ends.
    public func follow(_ outcomes: AsyncStream<OutboxOutcome>) {
        follower?.cancel()
        follower = Task { [weak self] in
            for await outcome in outcomes {
                guard let self else { return }
                self.apply(outcome)
            }
        }
    }

    public func stopFollowing() {
        follower?.cancel()
        follower = nil
    }

    func apply(_ outcome: OutboxOutcome) {
        guard outcome.method == "approval.respond" else { return }
        guard let key = answers.first(where: { $0.value.outboxId == outcome.id })?.key else {
            early[outcome.id] = outcome.result
            return
        }
        if case .delivered = outcome.result {
            answers.removeValue(forKey: key)
        } else {
            answers[key]?.status = Self.status(of: outcome.result)
        }
    }

    /// Forgets what the Mac has dealt with once its question is no longer in the Inbox. Waiting answers stay.
    public func prune(keeping callIds: Set<String>) {
        for (key, entry) in answers where entry.status != .waiting && !callIds.contains(key) {
            answers.removeValue(forKey: key)
        }
    }

    public func clear() {
        answers = [:]
        early = [:]
    }

    private static func status(of result: OutboxOutcome.Result) -> PendingAnswer.Status {
        switch result {
        case .delivered: .waiting
        case .rejected(let code, let message):
            code == ConnectionApprovalChannel.approvalNotFound ? .answeredOnMac : .failed(message)
        }
    }

    // MARK: Test seam

    /// Records a queued answer without a connection, for the screens' fakes.
    public func record(sessionId: String, callId: String, decision: Decision) {
        guard !isWaiting(callId: callId) else { return }
        answers[callId] = PendingAnswer(
            sessionId: sessionId, callId: callId, decision: decision, status: .waiting, outboxId: UUID())
    }
}
