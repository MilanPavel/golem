import Foundation

/// The banner the app shows while it cannot reach the Mac (ADR-051), one for each cause.
public struct OfflineBanner: Equatable, Sendable {
    public enum Cause: Equatable, Sendable {
        case noNetwork
        case relayUnreachable
        case macUnreachable
    }

    public var cause: Cause
    public var title: String
    public var detail: String

    /// The banner for the connection now, or nil when nothing is wrong or the first connection is still opening.
    /// `networkAvailable` is the phone's own network; without it, the relay is not the problem.
    public static func make(state: ConnectionState, networkAvailable: Bool, waiting: Int) -> OfflineBanner? {
        let tail = waiting > 0 ? " \(waiting == 1 ? "1 answer waits" : "\(waiting) answers wait")." : ""
        switch state {
        case .connected, .stopped: return nil
        case .connecting, .macUnreachable, .relayUnreachable:
            if !networkAvailable {
                return OfflineBanner(
                    cause: .noNetwork, title: "No network",
                    detail: "Answers will be sent when you are back online.\(tail)")
            }
            switch state {
            case .macUnreachable:
                return OfflineBanner(
                    cause: .macUnreachable, title: "Can't reach your Mac",
                    detail: "Your Mac is asleep or offline. Answers will be sent when it is back.\(tail)")
            case .relayUnreachable:
                return OfflineBanner(
                    cause: .relayUnreachable, title: "Can't reach the relay",
                    detail: "Answers will be sent when it is back.\(tail)")
            default:
                return nil
            }
        }
    }

    /// "Updated 08:47" for a stale Inbox, in the phone's own time format. Nil when nothing was ever read.
    public static func updatedText(_ date: Date?, calendar: Calendar = .current, locale: Locale = .current) -> String? {
        guard let date else { return nil }
        let format = Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, calendar: calendar)
        return "Updated \(date.formatted(format))"
    }
}
