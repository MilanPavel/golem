import Foundation

/// What a run is doing while it works.
public enum RunPhase: String, Sendable {
    case thinking, writing, waiting
}

/// What golem is doing, as the UI shows it.
public enum GolemState: String, Sendable, Equatable {
    case idle, thinking, waiting, failed, offline
}

/// No daemon wins, then an approval, then any work, then an error, then idle.
public func golemState(connected: Bool, phase: RunPhase?, error: Bool) -> GolemState {
    if !connected { return .offline }
    if phase == .waiting { return .waiting }
    if phase != nil { return .thinking }
    return error ? .failed : .idle
}

extension ChatState {
    /// The phase of the run in the transcript: waiting while a tool call waits for an answer, else
    /// thinking while the run is busy, else nil.
    public var phase: RunPhase? {
        if approval != nil { return .waiting }
        return busy ? .thinking : nil
    }
}
