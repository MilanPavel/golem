import Foundation

/// What became of a queued request.
public struct OutboxOutcome: Sendable, Equatable {
    public enum Result: Sendable, Equatable {
        /// The Mac answered with a result.
        case delivered
        /// The Mac answered with an error, such as `approval not found` when the question was
        /// answered elsewhere first. The entry is dropped: a retry would get the same answer.
        case rejected(code: Int, message: String)
    }

    public let id: UUID
    public let method: String
    public let result: Result
}

/// A small in-app queue for answers given while the Mac is not reachable (ADR-051, "The Mac
/// asleep, and answers sent late"). It is in memory: an answer survives a dropped link, not a
/// killed app. Keeping it on disk is 14.5.5's call.
///
/// Delivery is at least once: an entry that was sent but not answered when the link dropped
/// goes out again. That is safe only for a request that names what it answers. `approval.respond`
/// names the `call_id`, and the daemon refuses a second answer, so it is the one method allowed.
struct Outbox {
    struct Entry {
        let id: UUID
        let method: String
        let params: Data
        var inFlight = false
    }

    static let capacity = 64
    static let allowedMethods: Set<String> = ["approval.respond"]

    private(set) var entries: [Entry] = []

    var count: Int { entries.count }

    mutating func add(method: String, params: Data) throws -> UUID {
        guard Self.allowedMethods.contains(method) else { throw ConnectionError.outboxMethodNotAllowed(method) }
        guard entries.count < Self.capacity else { throw ConnectionError.outboxFull }
        let entry = Entry(id: UUID(), method: method, params: params)
        entries.append(entry)
        return entry.id
    }

    /// The entries to send now, in order, marked as in flight.
    mutating func takeReady() -> [Entry] {
        var ready: [Entry] = []
        for index in entries.indices where !entries[index].inFlight {
            entries[index].inFlight = true
            ready.append(entries[index])
        }
        return ready
    }

    mutating func release(_ id: UUID) {
        if let index = entries.firstIndex(where: { $0.id == id }) { entries[index].inFlight = false }
    }

    mutating func remove(_ id: UUID) {
        entries.removeAll { $0.id == id }
    }
}
