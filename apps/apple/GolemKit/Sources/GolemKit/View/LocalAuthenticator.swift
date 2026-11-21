import Foundation
import LocalAuthentication

/// Face ID or Touch ID, and the device passcode when they are not set up or fail
/// (`deviceOwnerAuthentication`). A new context for every ask, so a success is not reused.
public struct LocalAuthenticator: ApprovalAuthenticator {
    public init() {}

    public func isAvailable() -> Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    public func confirm(reason: String) async -> Bool {
        let context = LAContext()
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
