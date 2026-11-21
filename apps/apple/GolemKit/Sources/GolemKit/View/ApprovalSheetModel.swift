import Foundation
import Observation

// The approval sheet's state and the answers it sends. Face ID is behind `ApprovalAuthenticator` and the
// wire behind `ApprovalChannel`, so a test swaps both.

/// Proof that the owner, and not someone holding an unlocked phone, is answering (ADR-052).
public protocol ApprovalAuthenticator: Sendable {
    /// Whether the phone has Face ID, Touch ID or a passcode to ask with.
    func isAvailable() -> Bool
    /// Asks for it. False when the owner cancels or fails.
    func confirm(reason: String) async -> Bool
}

/// An answer from somewhere, as `approval.resolved` says it.
public struct ApprovalResolution: Equatable, Sendable {
    public var sessionId: String
    public var callId: String
    public var decision: Decision
    /// The paired phone that answered; nil for the Mac, the browser or the terminal.
    public var device: String?

    public init(sessionId: String, callId: String, decision: Decision, device: String?) {
        self.sessionId = sessionId
        self.callId = callId
        self.decision = decision
        self.device = device
    }
}

/// The Mac, as the sheet needs it.
public protocol ApprovalChannel: Sendable {
    /// `approval.respond`. Throws `ApprovalFailure.alreadyAnswered` when no run waits on the call any more.
    func respond(sessionId: String, callId: String, decision: Decision) async throws
    /// The answers that reach the Mac, from any client.
    func resolutions() -> AsyncStream<ApprovalResolution>
}

public enum ApprovalFailure: Error, Equatable {
    case alreadyAnswered
    case failed(String)
}

/// `approval.respond` over the connection, and the `approval.resolved` events it delivers. The device the
/// Mac notes with an "Always allow" is the one the gateway knows from this connection. The phone sends
/// no device id.
public struct ConnectionApprovalChannel: ApprovalChannel {
    /// The daemon's code for "no run waits on this tool call".
    static let approvalNotFound = -32010
    private let connection: Connection

    public init(connection: Connection) {
        self.connection = connection
    }

    public func respond(sessionId: String, callId: String, decision: Decision) async throws {
        let params = ApprovalRespondParams(args: nil, callID: callId, decision: decision, scope: nil, sessionID: sessionId)
        do {
            let _: ApprovalRespondResult = try await connection.call("approval.respond", params)
        } catch ConnectionError.rpc(let code, let message) {
            if code == Self.approvalNotFound { throw ApprovalFailure.alreadyAnswered }
            throw ApprovalFailure.failed(message)
        } catch ConnectionError.notConnected, ConnectionError.timedOut {
            throw ApprovalFailure.failed("Your Mac is not reachable.")
        } catch {
            throw ApprovalFailure.failed("The answer did not reach your Mac.")
        }
    }

    public func resolutions() -> AsyncStream<ApprovalResolution> {
        let connection = connection
        return AsyncStream { continuation in
            let task = Task {
                for await event in await connection.events() {
                    if case .approvalResolved(let resolved) = event, let session = event.sessionID {
                        continuation.yield(ApprovalResolution(
                            sessionId: session, callId: resolved.data.callID, decision: resolved.data.decision,
                            device: resolved.data.device
                        ))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// How an approval sheet stands or ended.
public enum ApprovalPhase: Equatable, Sendable {
    case ready
    /// Face ID or the passcode is up.
    case confirming
    case sending
    /// Answered from this phone.
    case answered(Decision)
    /// Answered somewhere else first.
    case answeredElsewhere
    /// The answer did not go; the sheet stays so the owner can try again.
    case failed(String)
}

@MainActor @Observable
public final class ApprovalSheetModel {
    public static let answeredElsewhereText = "Answered on the Mac"

    public let request: ApprovalRequest
    public let deviceName: String
    public private(set) var phase: ApprovalPhase = .ready
    /// Why the last confirmation did not go through; nil otherwise.
    public private(set) var confirmNote: String?

    private let authenticator: any ApprovalAuthenticator
    private let channel: any ApprovalChannel
    private var follower: Task<Void, Never>?

    public init(
        request: ApprovalRequest, deviceName: String, authenticator: any ApprovalAuthenticator,
        channel: any ApprovalChannel
    ) {
        self.request = request
        self.deviceName = deviceName
        self.authenticator = authenticator
        self.channel = channel
    }

    // MARK: What the sheet offers

    /// Allow once on this call needs Face ID.
    public var onceNeedsProof: Bool { isRiskyApproval(request) }
    /// A phone with neither Face ID nor a passcode cannot save a rule or allow a risky tool.
    public var canProve: Bool { authenticator.isAvailable() }
    public var showsAllowOnce: Bool { !onceNeedsProof || canProve }
    public var showsAlwaysAllow: Bool { canProve }
    public var ruleNote: String { alwaysAllowNote(request, deviceName: deviceName) }

    /// Whether the buttons are off: an answer is on its way.
    public var isBusy: Bool {
        switch phase {
        case .ready, .failed: false
        default: true
        }
    }

    /// Whether the sheet is finished and should close.
    public var isClosing: Bool {
        switch phase {
        case .answered, .answeredElsewhere: true
        default: false
        }
    }

    /// The line that says how the sheet ended; nil while it is open.
    public var closingText: String? {
        switch phase {
        case .answeredElsewhere: Self.answeredElsewhereText
        case .answered(.deny): "Denied"
        case .answered(.allowAlways): "Always allowed"
        case .answered: "Allowed"
        default: nil
        }
    }

    // MARK: Answers

    public func allowOnce() async {
        await answer(.allow, proof: onceNeedsProof ? "Allow \(request.name) on your Mac" : nil)
    }

    public func alwaysAllow() async {
        await answer(.allowAlways, proof: "Save a rule: always allow \(alwaysAllowRuleText(request))")
    }

    /// Deny never asks for Face ID.
    public func deny() async {
        await answer(.deny, proof: nil)
    }

    private func answer(_ decision: Decision, proof reason: String?) async {
        guard !isBusy else { return }
        confirmNote = nil
        if let reason {
            guard authenticator.isAvailable() else {
                phase = .failed("This phone has no Face ID or passcode, so it cannot do this.")
                return
            }
            phase = .confirming
            let confirmed = await authenticator.confirm(reason: reason)
            // Someone else may have answered while Face ID was up.
            if phase == .answeredElsewhere { return }
            guard confirmed else {
                phase = .ready
                confirmNote = "Not confirmed. Nothing was sent."
                return
            }
        }
        phase = .sending
        do {
            try await channel.respond(sessionId: request.sessionId, callId: request.callId, decision: decision)
            if phase != .answeredElsewhere { phase = .answered(decision) }
        } catch ApprovalFailure.alreadyAnswered {
            phase = .answeredElsewhere
        } catch ApprovalFailure.failed(let message) {
            phase = .failed(message)
        } catch {
            phase = .failed("The answer did not reach your Mac.")
        }
    }

    // MARK: Answered elsewhere

    /// Reads the Mac's answers until the sheet ends. Call it when the sheet appears.
    public func follow() {
        follower?.cancel()
        let stream = channel.resolutions()
        follower = Task { [weak self] in
            for await resolution in stream {
                guard let self else { return }
                self.apply(resolution)
            }
        }
    }

    public func stopFollowing() {
        follower?.cancel()
        follower = nil
    }

    /// An answer from any client. It closes the sheet when it is for this call and this phone has not
    /// answered it itself.
    public func apply(_ resolution: ApprovalResolution) {
        guard resolution.sessionId == request.sessionId, resolution.callId == request.callId else { return }
        switch phase {
        case .answered, .answeredElsewhere, .sending: return
        default: phase = .answeredElsewhere
        }
    }
}
