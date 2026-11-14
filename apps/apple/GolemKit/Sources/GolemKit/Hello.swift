import Foundation

/// Why the app refuses a daemon after `hello`.
public enum HelloError: Error, Equatable {
    case majorMismatch(app: Int, daemon: Int)
}

public extension HelloParams {
    /// The `hello` this build sends: its protocol version and a client name.
    static func current(client: String) -> HelloParams {
        HelloParams(client: client, protocolMajor: ProtocolVersion.major, protocolMinor: ProtocolVersion.minor)
    }
}

public extension HelloResult {
    /// Throws when the daemon's protocol major differs from this build's. A newer
    /// minor is fine: unknown events and fields decode to fallbacks.
    func check() throws {
        guard protocolMajor == ProtocolVersion.major else {
            throw HelloError.majorMismatch(app: ProtocolVersion.major, daemon: protocolMajor)
        }
    }
}

public extension MethodAccess {
    /// Whether the app may call `method` (the browser set).
    static func appMayCall(_ method: String) -> Bool {
        browser.contains(method)
    }
}
