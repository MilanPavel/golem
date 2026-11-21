#if DEBUG
import Foundation
import GolemKit

/// For the UI tests: `-uiTestFakePairing` swaps the relay and the Mac for scripted ones, and the
/// Keychain for memory, so a test needs no network and leaves nothing behind.
enum DebugEnvironment {
    static func fromLaunchArguments() -> AppEnvironment? {
        guard ProcessInfo.processInfo.arguments.contains("-uiTestFakePairing") else { return nil }
        return AppEnvironment(
            store: InMemoryMacStore(),
            pairing: { FakePairing() },
            link: { _ in FakeLink() },
            authenticator: FakeAuthenticator(),
            deviceName: "iPhone 16")
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

/// A Mac that is connected and has two sessions.
@MainActor
final class FakeLink: MacLink {
    func start() -> AsyncStream<ConnectionState> {
        AsyncStream { continuation in
            continuation.yield(.connecting)
            continuation.yield(.connected)
            continuation.finish()
        }
    }

    func refresh(into list: SessionListModel) async throws {
        list.replace(with: [
            InboxSession(sessionId: "s1", title: "Fix the flaky test", status: "running", updatedAt: "2026-11-21T10:00:00Z"),
            InboxSession(sessionId: "s2", title: "Upgrade httpx", status: "idle", updatedAt: "2026-11-21T09:00:00Z"),
        ])
    }

    func stop() async {}

    var approvals: any ApprovalChannel { FakeApprovalChannel() }
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
