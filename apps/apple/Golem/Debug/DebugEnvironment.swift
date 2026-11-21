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
            link: { _ in FakeLink() })
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
}
#endif
