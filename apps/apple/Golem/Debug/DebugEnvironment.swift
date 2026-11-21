#if DEBUG
import Foundation
import GolemKit

/// For the UI tests: `-uiTestFakePairing` swaps the relay and the Mac for scripted ones, and the
/// Keychain for memory, so a test needs no network and leaves nothing behind.
enum DebugEnvironment {
    static func fromLaunchArguments() -> AppEnvironment? {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("-uiTestFakePairing") else { return nil }
        // `-uiTestScenario <name>` starts already paired, with the Mac in that state.
        var scenario = FakeScenario.empty
        var paired: PairedMac?
        if let at = arguments.firstIndex(of: "-uiTestScenario"), at + 1 < arguments.count,
           let named = FakeScenario(rawValue: arguments[at + 1]) {
            scenario = named
            paired = PairedMac(
                relayURL: URL(string: "wss://relay.example.com")!, macSigningKey: Data(), macNoiseKey: Data(),
                name: "Studio Mac")
        }
        return AppEnvironment(
            store: InMemoryMacStore(paired),
            pairing: { FakePairing() },
            link: { _ in FakeLink(scenario: scenario) },
            authenticator: FakeAuthenticator(),
            deviceName: "iPhone 16",
            network: { AsyncStream { $0.yield(scenario != .offline) } })
    }
}

/// A pairing that always works: connecting, then the words, then paired.
struct FakePairing: PairingService {
    static let words = ["kiln", "otter", "maple"]

    func pair(with link: PairLink) -> AsyncThrowingStream<PairingStep, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                continuation.yield(.connecting)
                try? await Task.sleep(nanoseconds: 300_000_000)
                continuation.yield(.words(Self.words))
                // The owner confirming on the Mac, a moment later.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard !Task.isCancelled else { return }
                // The real service saves the Mac before it says `.paired`. The fake has no store of its own.
                continuation.yield(.paired(macName: link.macName))
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// What the fake Mac shows, set by `-uiTestScenario <name>`.
enum FakeScenario: String {
    /// Connected, two idle chats, nothing waiting or running.
    case empty
    /// Two sessions wait for an approval.
    case needs
    /// One run in progress and one finished today, nothing waiting.
    case activity
    /// The Mac cannot be reached.
    case disconnected
    /// Starts empty; an approval arrives a moment after launch, as a summary from the Mac.
    case live
    /// Two sessions wait; a moment after launch the Mac goes to sleep, and answers queue.
    case asleep
    /// Like `asleep`, with the phone's network off and the relay out of reach.
    case offline
}

/// A Mac that is connected and has two sessions, or whatever the scenario says.
@MainActor
final class FakeLink: MacLink {
    private let scenario: FakeScenario
    let pendingAnswers: PendingAnswers

    // Called from the app model, on the main actor.
    nonisolated init(scenario: FakeScenario = .empty) {
        self.scenario = scenario
        pendingAnswers = MainActor.assumeIsolated { PendingAnswers() }
    }

    private nonisolated static func iso(_ secondsAgo: TimeInterval) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-secondsAgo))
    }

    private nonisolated static func approval(_ id: String, title: String, subject: String, minutesAgo: Double) -> InboxSession {
        InboxSession(
            sessionId: id, title: title, status: "waiting",
            pending: InboxPending(
                kind: .approval, since: iso(minutesAgo * 60), callId: "call-\(id)", name: "shell", subject: subject,
                source: "rule: shell"),
            updatedAt: iso(minutesAgo * 60))
    }

    func start() -> AsyncStream<ConnectionState> {
        let scenario = scenario
        return AsyncStream { continuation in
            continuation.yield(.connecting)
            continuation.yield(scenario == .disconnected ? .macUnreachable : .connected)
            guard scenario == .asleep || scenario == .offline else {
                continuation.finish()
                return
            }
            // The Mac goes away after the Inbox has been read, so what was read stays on screen.
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                continuation.yield(scenario == .offline ? .relayUnreachable : .macUnreachable)
                continuation.finish()
            }
        }
    }

    func refresh(into list: SessionListModel) async throws {
        switch scenario {
        case .empty, .live:
            list.replace(with: [
                InboxSession(sessionId: "s1", title: "Fix the flaky test", status: "running", updatedAt: "2026-11-21T10:00:00Z"),
                InboxSession(sessionId: "s2", title: "Upgrade httpx", status: "idle", updatedAt: "2026-11-21T09:00:00Z"),
            ])
        case .needs, .asleep, .offline:
            list.replace(with: [
                Self.approval("s1", title: "Fix the flaky test", subject: "rm -rf build", minutesAgo: 4),
                Self.approval("s2", title: "Upgrade httpx", subject: "uv lock --upgrade", minutesAgo: 1),
            ])
        case .activity, .disconnected:
            list.replace(with: [])
        }
    }

    func refresh(into runs: RunsModel) async throws {
        guard scenario == .activity else { return }
        let dayStart = Calendar.current.startOfDay(for: Date()).timeIntervalSince1970
        let formatter = ISO8601DateFormatter()
        func today(_ secondsAgo: TimeInterval) -> String {
            formatter.string(from: Date(timeIntervalSince1970: max(dayStart, Date().timeIntervalSince1970 - secondsAgo)))
        }
        runs.replace(with: [
            RunLike(
                sessionId: "run1", kind: "routine", routine: "pr-digest", trigger: "schedule", status: .running,
                startedAt: Self.iso(75)),
            RunLike(
                sessionId: "run2", kind: "routine", routine: "morning-brief", trigger: "schedule", status: .succeeded,
                startedAt: today(300), endedAt: today(240), summary: "Three PRs need a look."),
        ])
    }

    func summaries() -> AsyncStream<InboxSession> {
        let scenario = scenario
        return AsyncStream { continuation in
            guard scenario == .live else { return }
            Task {
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                continuation.yield(Self.approval("s3", title: "Deploy the docs", subject: "git push", minutesAgo: 0))
            }
        }
    }

    func stop() async {}

    var approvals: any ApprovalChannel {
        scenario == .asleep || scenario == .offline ? FakeOfflineChannel(pending: pendingAnswers) : FakeApprovalChannel()
    }

    /// A shell call whose command is the subject the fake session says.
    func approvalRequest(for item: InboxItem, folder: String?) async -> ApprovalRequest {
        let command = Self.commands[item.callId ?? ""] ?? "true"
        return ApprovalRequest(
            sessionId: item.answerSessionId, callId: item.callId ?? "", name: "shell", command: command, subject: command,
            folder: "~/code/shop", origin: item.sessionTitle, source: item.source ?? "built-in default")
    }

    private nonisolated static let commands = [
        "call-s1": "rm -rf build", "call-s2": "uv lock --upgrade", "call-s3": "git push",
    ]
}

/// Face ID that always passes.
struct FakeAuthenticator: ApprovalAuthenticator {
    func isAvailable() -> Bool { true }
    func confirm(reason: String) async -> Bool { true }
}

/// A Mac that takes every answer, and answers the call `call-elsewhere` itself a second after the sheet opens.
struct FakeApprovalChannel: ApprovalChannel {
    func respond(sessionId: String, callId: String, decision: Decision) async throws {
        try? await Task.sleep(nanoseconds: 100_000_000)
    }

    func resolutions() -> AsyncStream<ApprovalResolution> {
        AsyncStream { continuation in
            let task = Task {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { return }
                continuation.yield(ApprovalResolution(
                    sessionId: "s1", callId: "call-elsewhere", decision: .deny, device: nil))
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// A Mac that is away: every answer waits, as the real channel does when the outbox takes it.
struct FakeOfflineChannel: ApprovalChannel {
    let pending: PendingAnswers

    func respond(sessionId: String, callId: String, decision: Decision) async throws {
        await pending.record(sessionId: sessionId, callId: callId, decision: decision)
        throw ApprovalFailure.queued
    }

    func resolutions() -> AsyncStream<ApprovalResolution> { AsyncStream { _ in } }
}

/// The approvals the debug menu opens.
enum DebugApprovals {
    static let all: [(id: String, label: String, request: ApprovalRequest)] = [
        ("shell", "Shell command", ApprovalRequest(
            sessionId: "s1", callId: "call-shell", name: "shell", command: "git push origin main --force-with-lease",
            subject: "git push origin main --force-with-lease", folder: "~/code/shop", origin: "Fix the flaky test",
            source: "built-in default")),
        ("edit", "Edit a file in the folder", ApprovalRequest(
            sessionId: "s1", callId: "call-edit", name: "edit_file", subject: "src/cart.ts",
            diff: "--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -10,3 +10,3 @@\n-  retry(2)\n+  retry(3)\n",
            path: "src/cart.ts", folder: "~/code/shop", origin: "Fix the flaky test", source: "built-in default")),
        ("mcp", "MCP tool", ApprovalRequest(
            sessionId: "s1", callId: "call-mcp", name: "mcp__linear__create_issue",
            argsText: "{\n  \"team\": \"Web\",\n  \"title\": \"NPE in checkout\"\n}", folder: "~/code/shop",
            origin: "NPE in checkout", source: "built-in default")),
        ("elsewhere", "Answered on the Mac", ApprovalRequest(
            sessionId: "s1", callId: "call-elsewhere", name: "read_file", subject: "README.md", path: "README.md",
            folder: "~/code/shop", origin: "Upgrade httpx", source: "built-in default")),
    ]
}

/// A review step that takes every answer.
struct FakeReviewResponder: ReviewResponder {
    func answer(_ answer: ReviewAnswer, for review: ReviewRequest) async throws {}
}
#endif
