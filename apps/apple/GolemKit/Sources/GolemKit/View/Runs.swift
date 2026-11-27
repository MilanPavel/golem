import Foundation

// The Runs list in words: which group a run is in, and the words of its row and of the banner a
// routine's session shows. This is `packages/view/src/runs.ts`, with the pieces of `routines.ts`
// it reads (`runWhenText`, `lastResultText`). A row is a headless session: a routine's firing, or a
// detached ask. A workflow run is a row of another `kind` with a `steps` count and no `trigger`.
//
// Times are local. Every function that says a time or a day takes `now` (milliseconds) and a
// calendar, so a test and a ticking screen agree.

public enum RunStatus: String, Codable, Sendable, Equatable {
    case queued, running, waiting, succeeded, failed, skipped, cancelled
}

/// The parts of a `RunInfo` these words read. Missing and nil mean the same: not known.
public struct RunLike: Codable, Sendable, Equatable, Identifiable {
    public var sessionId: String
    /// `routine`, `ask`, and later `workflow`.
    public var kind: String?
    public var routine: String?
    /// `schedule`, `watch`, `manual` or `hook`.
    public var trigger: String?
    public var status: RunStatus
    public var startedAt: String?
    public var endedAt: String?
    /// The question while the run waits, the last reply once it finished.
    public var summary: String?
    public var reason: String?
    /// How many approvals the run waits for.
    public var approvals: Int?
    /// The file a `watch` firing is for.
    public var watchPath: String?
    /// The steps of a workflow run.
    public var steps: Int?

    public var id: String { sessionId }

    enum CodingKeys: String, CodingKey {
        case kind, routine, trigger, status, summary, reason, approvals, steps
        case sessionId = "session_id", startedAt = "started_at", endedAt = "ended_at", watchPath = "watch_path"
        case workflowRunId = "workflow_run_id"
    }

    /// A workflow run has no session until a step needs one, so its row has no `session_id`: the
    /// run's own id stands in, and a row is keyed the same way (the web uses `runKey`).
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let session = try container.decodeIfPresent(String.self, forKey: .sessionId)
        let workflow = try container.decodeIfPresent(String.self, forKey: .workflowRunId)
        guard let key = workflow ?? session else {
            throw DecodingError.keyNotFound(
                CodingKeys.sessionId,
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "a run has no id"))
        }
        sessionId = key
        kind = try container.decodeIfPresent(String.self, forKey: .kind)
        routine = try container.decodeIfPresent(String.self, forKey: .routine)
        trigger = try container.decodeIfPresent(String.self, forKey: .trigger)
        status = try container.decode(RunStatus.self, forKey: .status)
        startedAt = try container.decodeIfPresent(String.self, forKey: .startedAt)
        endedAt = try container.decodeIfPresent(String.self, forKey: .endedAt)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        approvals = try container.decodeIfPresent(Int.self, forKey: .approvals)
        watchPath = try container.decodeIfPresent(String.self, forKey: .watchPath)
        steps = try container.decodeIfPresent(Int.self, forKey: .steps)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(kind, forKey: .kind)
        try container.encodeIfPresent(routine, forKey: .routine)
        try container.encodeIfPresent(trigger, forKey: .trigger)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(startedAt, forKey: .startedAt)
        try container.encodeIfPresent(endedAt, forKey: .endedAt)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encodeIfPresent(reason, forKey: .reason)
        try container.encodeIfPresent(approvals, forKey: .approvals)
        try container.encodeIfPresent(watchPath, forKey: .watchPath)
        try container.encodeIfPresent(steps, forKey: .steps)
    }

    public init(
        sessionId: String, kind: String? = nil, routine: String? = nil, trigger: String? = nil, status: RunStatus,
        startedAt: String? = nil, endedAt: String? = nil, summary: String? = nil, reason: String? = nil,
        approvals: Int? = nil, watchPath: String? = nil, steps: Int? = nil
    ) {
        self.sessionId = sessionId
        self.kind = kind
        self.routine = routine
        self.trigger = trigger
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.summary = summary
        self.reason = reason
        self.approvals = approvals
        self.watchPath = watchPath
        self.steps = steps
    }

    /// A `RunInfo` (or `RunElement`) from `run.list`: the same keys.
    public init<Info: Encodable>(info: Info) throws {
        self = try JSONDecoder().decode(RunLike.self, from: JSONEncoder().encode(info))
    }
}

/// The groups, in the order the Runs list shows them.
public enum RunGroupLabel: String, Sendable, CaseIterable {
    case needsYou = "Needs you"
    case running = "Running"
    case today = "Today"
    case earlier = "Earlier"
}

public struct RunGroup: Sendable, Equatable {
    public var label: RunGroupLabel
    public var items: [RunLike]
}

/// The name a detached ask goes by, since it has no routine.
public let ASK_NAME = "golem ask"

private func startOf(_ run: RunLike) -> Double {
    run.startedAt.flatMap(parseTime) ?? -.infinity
}

/// Whether a run needs the person: it is waiting for an answer.
public func runNeedsYou(_ run: RunLike) -> Bool {
    run.status == .waiting || (run.approvals ?? 0) > 0
}

/// Newest start first; equal starts keep their order.
private func newestFirst(_ runs: [RunLike]) -> [RunLike] {
    runs.enumerated().sorted { left, right in
        let x = startOf(left.element)
        let y = startOf(right.element)
        return x == y ? left.offset < right.offset : x > y
    }.map(\.element)
}

private func startOfDay(_ ms: Double, _ calendar: Calendar) -> Double {
    calendar.startOfDay(for: Date(timeIntervalSince1970: ms / 1000)).timeIntervalSince1970 * 1000
}

/// The runs in their groups, in this order, with empty groups left out:
/// - **Needs you**: waiting for an answer.
/// - **Running**: queued or running.
/// - **Today**: everything else that started on today's local date.
/// - **Earlier**: the rest, and a run with no readable start.
///
/// Inside a group the newest start comes first. A start in the future counts as today.
public func runGroups(_ runs: [RunLike], now: Double, calendar: Calendar = .current) -> [RunGroup] {
    let today = startOfDay(now, calendar)
    var buckets: [[RunLike]] = [[], [], [], []]
    for run in runs {
        let index = runNeedsYou(run) ? 0 : run.status == .running || run.status == .queued ? 1 : startOf(run) >= today ? 2 : 3
        buckets[index].append(run)
    }
    return RunGroupLabel.allCases.enumerated().compactMap { index, label in
        buckets[index].isEmpty ? nil : RunGroup(label: label, items: newestFirst(buckets[index]))
    }
}

/// How many runs need the person: the number on the badge and in "Needs you (2)".
public func needsYouCount(_ runs: [RunLike]) -> Int {
    runs.filter(runNeedsYou).count
}

/// The runs that need the person, other than the session they are in, newest start first.
public func needsYouElsewhere(_ runs: [RunLike], currentSessionId: String?) -> [RunLike] {
    newestFirst(runs.filter { runNeedsYou($0) && $0.sessionId != currentSessionId })
}

/// A group's heading with its count: `Needs you (2)`.
public func runGroupHeading(_ group: RunGroup) -> String {
    "\(group.label.rawValue) (\(group.items.count))"
}

/// The row's name: the routine's, or `golem ask` for a detached ask.
public func runName(_ run: RunLike) -> String {
    run.routine ?? ASK_NAME
}

private func baseName(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? path
}

/// What started the run: `by schedule`, `by you` (run now), `by new file receipt-0412.pdf`, `by hook`,
/// and `from the CLI` for a detached ask. A run with no trigger and no routine, such as a workflow
/// run, gives an empty string and the screen says its own words (its steps).
public func runTriggerWords(_ run: RunLike) -> String {
    switch run.trigger {
    case "schedule": return "by schedule"
    case "manual": return "by you"
    case "hook": return "by hook"
    case "watch":
        if let path = run.watchPath, !path.isEmpty { return "by new file \(baseName(path))" }
        return "by new file"
    default:
        return run.kind == "ask" || (run.kind == nil && run.routine == nil) ? "from the CLI" : ""
    }
}

private func clock(_ hour: Int, _ minute: Int) -> String {
    String(format: "%02d:%02d", hour, minute)
}

private let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
private let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// When a run started, for a History row: `Today 08:30`, `Yesterday 08:30`, then `Tue 10 Nov`. Local time.
/// Empty when unreadable.
public func runWhenText(_ iso: String?, now: Double, calendar: Calendar = .current) -> String {
    guard let iso, let ms = parseTime(iso) else { return "" }
    let at = Date(timeIntervalSince1970: ms / 1000)
    let parts = calendar.dateComponents([.hour, .minute, .weekday, .day, .month], from: at)
    let days = Int(((startOfDay(now, calendar) - startOfDay(ms, calendar)) / 86_400_000).rounded())
    let hour = parts.hour ?? 0, minute = parts.minute ?? 0
    if days == 0 { return "Today \(clock(hour, minute))" }
    if days == 1 { return "Yesterday \(clock(hour, minute))" }
    return "\(dayNames[(parts.weekday ?? 1) - 1]) \(parts.day ?? 1) \(monthNames[(parts.month ?? 1) - 1])"
}

/// When the run started: `08:30` today, else `Yesterday 08:30` or `Tue 10 Nov`. Empty when unreadable.
public func runStartedText(_ run: RunLike, now: Double, calendar: Calendar = .current) -> String {
    let text = runWhenText(run.startedAt, now: now, calendar: calendar)
    return text.hasPrefix("Today ") ? String(text.dropFirst(6)) : text
}

/// `1 step`, `4 steps`: what a workflow run shows where a routine run shows its trigger. Empty when there is no count.
public func runStepsWords(_ run: RunLike) -> String {
    guard let steps = run.steps else { return "" }
    return steps == 1 ? "1 step" : "\(steps) steps"
}

/// The row's second line: the trigger (or, for a run that has none, its steps) and the start,
/// `by schedule · 10:00`. A part that is empty is left out.
public func runRowLine(_ run: RunLike, now: Double, calendar: Calendar = .current) -> String {
    let how = runTriggerWords(run)
    return [how.isEmpty ? runStepsWords(run) : how, runStartedText(run, now: now, calendar: calendar)]
        .filter { !$0.isEmpty }.joined(separator: " \u{b7} ")
}

/// How long the run took, or has taken: `1m 04s`. A run that is running or waiting counts up to `now`.
/// A queued run says `queued`. A run without both times, and a skipped one, gives an empty string.
public func runDuration(_ run: RunLike, now: Double) -> String {
    if run.status == .queued { return "queued" }
    if run.status == .skipped { return "" }
    guard let start = run.startedAt.flatMap(parseTime) else { return "" }
    let open = run.status == .running || run.status == .waiting
    guard let end = open ? now : run.endedAt.flatMap(parseTime) else { return "" }
    let ms = end - start
    return ms < 0 ? "" : formatElapsed(ms)
}

private func firstLine(_ text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let line = trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    return line.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// One word or two for a run's status: "finished", "failed", "waiting for you".
public func runStatusWords(_ status: RunStatus) -> String {
    switch status {
    case .queued: return "queued"
    case .running: return "running"
    case .waiting: return "waiting for you"
    case .succeeded: return "finished"
    case .failed: return "failed"
    case .skipped: return "skipped"
    case .cancelled: return "stopped"
    }
}

/// How a run went: the start of its reply when it finished, the reason when it failed or was skipped
/// ("skipped: paused"), and the status words otherwise.
public func lastResultText(status: RunStatus, reason: String?, summary: String?) -> String {
    let reason = reason.map(firstLine) ?? ""
    let summary = summary.map(firstLine) ?? ""
    switch status {
    case .succeeded: return summary.isEmpty ? "finished" : summary
    case .failed: return !reason.isEmpty ? reason : !summary.isEmpty ? summary : "failed"
    case .skipped: return reason.isEmpty ? "skipped" : "skipped: \(reason)"
    default: return runStatusWords(status)
    }
}

/// One line of how the run went, or of what it asks: the question while it waits, the start of the
/// reply when it finished, the reason when it failed or was skipped, else the status words.
public func runResultLine(_ run: RunLike) -> String {
    let summary = run.summary.map(firstLine) ?? ""
    if run.status == .waiting && !summary.isEmpty { return summary }
    return lastResultText(status: run.status, reason: run.reason, summary: run.summary)
}

/// `1 approval waiting`, `2 approvals waiting`, and an empty string for none.
public func approvalsWords(_ count: Int) -> String {
    count <= 0 ? "" : count == 1 ? "1 approval waiting" : "\(count) approvals waiting"
}

/// The line of the banner a routine's session shows, from the same row as the list:
/// `Routine morning-brief · started 08:30 by schedule · 1 approval waiting`.
public func runBannerText(_ run: RunLike, now: Double, calendar: Calendar = .current) -> String {
    let started = runStartedText(run, now: now, calendar: calendar)
    let head = run.kind == "ask" || run.routine == nil ? runName(run) : "Routine \(run.routine!)"
    let how = [started.isEmpty ? "" : "started \(started)", runTriggerWords(run)].filter { !$0.isEmpty }.joined(separator: " ")
    return [head, how, approvalsWords(run.approvals ?? 0)].filter { !$0.isEmpty }.joined(separator: " \u{b7} ")
}
