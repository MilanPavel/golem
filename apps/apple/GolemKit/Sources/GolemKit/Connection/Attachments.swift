import Foundation

/// The sessions the app follows and the newest `seq` it has seen in each.
///
/// After a reconnect the connection attaches again from that `seq`. The daemon may replay
/// events the app already has, so `accept` drops anything not newer. This is the Swift side of
/// `packages/client/src/attachments.ts`.
struct Attachments {
    private var lastSeq: [String: Int] = [:]

    /// Follow `sessionID` from `afterSeq`, or from a newer `seq` already seen.
    mutating func track(_ sessionID: String, afterSeq: Int) {
        lastSeq[sessionID] = max(lastSeq[sessionID] ?? 0, afterSeq)
    }

    mutating func untrack(_ sessionID: String) {
        lastSeq[sessionID] = nil
    }

    /// The newest `seq` seen in a followed session, or nil.
    func seen(_ sessionID: String) -> Int? {
        lastSeq[sessionID]
    }

    /// `(sessionID, lastSeq)` for every followed session, in a stable order.
    func entries() -> [(String, Int)] {
        lastSeq.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    /// False for a followed session's event at or below its last seen `seq`.
    mutating func accept(sessionID: String, seq: Int) -> Bool {
        guard let seen = lastSeq[sessionID] else { return true }
        guard seq > seen else { return false }
        lastSeq[sessionID] = seq
        return true
    }
}
