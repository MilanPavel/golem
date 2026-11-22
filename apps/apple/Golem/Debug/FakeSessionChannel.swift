#if DEBUG
import Foundation
import GolemKit

/// A Mac that keeps a log for each session, replays it on attach, and answers a reply, a cancel and a new
/// task the way the daemon does, with events. For the UI tests.
///
/// - `s1`: a long transcript (40 questions). A new message arrives a few seconds after it is opened.
/// - `s2`: a short one with a tool step and todos.
/// - `run1`: a routine run still going. `run2`: a routine run that finished with a morning brief.
actor FakeSessionChannel: SessionChannel {
    private var log: [String: [GolemEvent]] = [:]
    private var attached: Set<String> = []
    private var subscribers: [UUID: AsyncStream<GolemEvent>.Continuation] = [:]
    private var counter = 0

    init() {
        log["s1"] = Self.long()
        log["s2"] = Self.short()
        log["run1"] = Self.runningRoutine()
        log["run2"] = Self.morningBrief()
    }

    func events() -> AsyncStream<GolemEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<GolemEvent>.makeStream(bufferingPolicy: .unbounded)
        subscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in Task { await self?.drop(id) } }
        return stream
    }

    private func drop(_ id: UUID) { subscribers[id] = nil }

    func attach(sessionId: String) async throws {
        attached.insert(sessionId)
        for event in log[sessionId] ?? [] { publish(event) }
        if sessionId == "s1" {
            Task {
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                self.append("s1", [Self.assistant("s1", "late", "A new note arrived while you were reading.", run: "late-run")])
            }
        }
    }

    func detach(sessionId: String) async {
        attached.remove(sessionId)
    }

    func send(sessionId: String, text: String) async throws -> String {
        counter += 1
        let run = "reply-\(counter)"
        let id = "reply-\(counter)"
        append(sessionId, [
            Self.event(sessionId, "message.completed", run, Self.message("\(id)-u", role: "user", text: text)),
            Self.event(sessionId, "run.started", run, [:]),
        ])
        Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            self.append(sessionId, [
                Self.assistant(sessionId, id, "Got it: \(text)", run: run),
                Self.event(sessionId, "run.completed", run, [:]),
            ])
        }
        return run
    }

    func cancel(runId: String) async throws {
        for (session, events) in log {
            for event in events.reversed() {
                if case .runStarted(let started) = event, started.runID == runId {
                    append(session, [Self.event(session, "run.cancelled", runId, ["reason": "user"])])
                    return
                }
            }
        }
    }

    func create(folder: String?) async throws -> String {
        counter += 1
        return "new\(counter)"
    }

    private func append(_ session: String, _ events: [GolemEvent]) {
        log[session, default: []].append(contentsOf: events)
        guard attached.contains(session) else { return }
        for event in events { publish(event) }
    }

    private func publish(_ event: GolemEvent) {
        for continuation in subscribers.values { continuation.yield(event) }
    }

    // MARK: - Fixtures

    private static func event(_ session: String, _ type: String, _ run: String?, _ data: [String: Any]) -> GolemEvent {
        let object: [String: Any] = [
            "type": type, "seq": 1, "session_id": session, "run_id": run ?? "", "ts": "2026-11-21T08:30:00Z", "data": data,
        ]
        // The fixtures are written here, so a bad one is a bug in this file.
        let data = try! JSONSerialization.data(withJSONObject: object)
        return try! JSONDecoder().decode(GolemEvent.self, from: data)
    }

    private static func message(_ id: String, role: String, text: String) -> [String: Any] {
        ["message_id": id, "role": role, "text": text, "interrupted": false]
    }

    private static func assistant(_ session: String, _ id: String, _ text: String, run: String) -> GolemEvent {
        event(session, "message.completed", run, message(id, role: "assistant", text: text))
    }

    private static func long() -> [GolemEvent] {
        var events: [GolemEvent] = []
        for index in 1...40 {
            let run = "run-\(index)"
            events.append(event("s1", "message.completed", run, message("q\(index)", role: "user", text: "Question \(index)")))
            events.append(event("s1", "run.started", run, [:]))
            events.append(event("s1", "message.started", run, ["message_id": "a\(index)", "role": "assistant"]))
            if index % 3 == 0 {
                events.append(event("s1", "tool.requested", run, [
                    "call_id": "c\(index)", "message_id": "a\(index)", "name": "read_file", "args": ["path": "notes.txt"],
                ]))
                events.append(event("s1", "tool.completed", run, [
                    "call_id": "c\(index)", "duration_ms": 3, "failed": false, "preview": "1| a", "summary": "42 lines",
                    "truncated": false,
                ]))
            }
            events.append(event("s1", "message.completed", run, message(
                "a\(index)", role: "assistant", text: "Answer \(index). It has **bold** words and enough text to wrap onto a second line of the screen.")))
            events.append(event("s1", "run.completed", run, [:]))
        }
        return events
    }

    private static func short() -> [GolemEvent] {
        [
            event("s2", "message.completed", "r1", message("u1", role: "user", text: "Upgrade httpx")),
            event("s2", "run.started", "r1", [:]),
            event("s2", "message.started", "r1", ["message_id": "m1", "role": "assistant"]),
            event("s2", "tool.requested", "r1", [
                "call_id": "t1", "message_id": "m1", "name": "shell", "args": ["command": "uv lock --upgrade"],
            ]),
            event("s2", "tool.failed", "r1", ["call_id": "t1", "message": "exit 1"]),
            event("s2", "todos.updated", "r1", ["todos": [
                ["id": "1", "text": "Bump the pin", "status": "done"],
                ["id": "2", "text": "Run the tests", "status": "in_progress"],
            ]]),
            event("s2", "message.completed", "r1", message("m1", role: "assistant", text: "The lock failed; trying again.")),
            event("s2", "run.completed", "r1", [:]),
        ]
    }

    private static func runningRoutine() -> [GolemEvent] {
        [
            event("run1", "message.completed", "rr", message("u1", role: "user", text: "Summarize the open PRs")),
            event("run1", "run.started", "rr", [:]),
            event("run1", "message.started", "rr", ["message_id": "m1", "role": "assistant"]),
            event("run1", "message.delta", "rr", ["message_id": "m1", "text": "Fetching the open PRs"]),
        ]
    }

    private static func morningBrief() -> [GolemEvent] {
        [
            event("run2", "message.completed", "mb", message("u1", role: "user", text: "Write the morning brief")),
            event("run2", "run.started", "mb", [:]),
            event("run2", "message.completed", "mb", message(
                "m1", role: "assistant",
                text: "Good morning.\nPRs: 6 open, 2 waiting on you.\nCI: 2 failing on main.\nLinear: 3 assigned.")),
            event("run2", "run.completed", "mb", [:]),
        ]
    }
}
#endif
