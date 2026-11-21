import Foundation

/// The milliseconds since 1970 of an ISO 8601 time, or nil when it does not read. Like `Date.parse`
/// in `packages/view`: a fraction beyond the millisecond is cut, not rounded.
func parseTime(_ text: String) -> Double? {
    for formatter in [timeWithFraction, timeWithoutFraction] {
        if let date = formatter.date(from: text) {
            return (date.timeIntervalSince1970 * 1000 + 0.001).rounded(.down)
        }
    }
    return nil
}

private let timeWithFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let timeWithoutFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

/// `now` for the functions that take it, in the milliseconds `Date.now()` gives.
public func nowMilliseconds(_ date: Date = Date()) -> Double {
    (date.timeIntervalSince1970 * 1000).rounded(.down)
}

/// `0m 03s`, `1m 04s`, `12m 00s`: whole seconds, rounded down. `0m 00s` for a negative or odd number.
public func formatElapsed(_ ms: Double) -> String {
    let seconds = ms.isFinite && ms > 0 ? Int(ms / 1000) : 0
    return "\(seconds / 60)m \(String(format: "%02d", seconds % 60))s"
}
