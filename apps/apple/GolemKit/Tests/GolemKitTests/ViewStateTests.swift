import Foundation
import Testing
@testable import GolemKit

// `Fixtures/view-state.json` is what `packages/view` makes of the golden logs, the Inbox and the Runs
// list, written by `just swift-fixtures`. These tests make the same things with GolemKit and compare.

private let packageFolder: URL = {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<3 { url.deleteLastPathComponent() }
    return url
}()

private let goldenFolder: URL = {
    var url = packageFolder
    for _ in 0..<3 { url.deleteLastPathComponent() }
    return url.appendingPathComponent("packages/view/fixtures/golden")
}()

private var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

// MARK: - The fixture's shape

private struct ToolProjection: Codable, Equatable {
    var callId: String
    var name: String
    var displayName: String
    var status: String
    var mark: String
    var failed: Bool
    var summary: String?
    var preview: String?
    var truncated: Bool
    var error: String?
    var output: String?
    var unsuccessful: Bool
    var diff: String?
    var approvalSource: String?
    var approvalSubject: String?
    var decision: String?
    var rule: String?
    var edited: Bool?

    init(_ tool: ToolBlock) {
        callId = tool.callId
        name = tool.name
        displayName = displayToolName(tool.name)
        status = tool.status.rawValue
        mark = stepMark(tool).rawValue
        failed = stepFailed(tool)
        summary = tool.summary
        preview = tool.preview
        truncated = tool.truncated == true
        error = tool.error
        output = tool.output
        unsuccessful = tool.unsuccessful == true
        diff = tool.diff
        approvalSource = tool.approval?.source
        approvalSubject = tool.approval?.subject
        decision = tool.approval?.answer?.decision.rawValue
        rule = tool.approval?.answer?.rule
        edited = tool.approval?.answer?.edited
    }
}

private struct MessageProjection: Codable, Equatable {
    var id: String
    var role: String
    var text: String
    var streaming: Bool
    var interrupted: Bool
    var at: String?
    var runId: String?
    var durationMs: Int?
    var thinking: String?
    var thinkingMs: Int?
    var skill: String?
    var tools: [ToolProjection]

    init(_ message: ChatMessage) {
        id = message.id
        role = message.role.rawValue
        text = message.text
        streaming = message.streaming
        interrupted = message.interrupted == true
        at = message.at
        runId = message.runId
        durationMs = message.durationMs
        thinking = message.thinking
        thinkingMs = message.thinkingMs
        skill = message.skill?.name
        tools = (message.tools ?? []).map(ToolProjection.init)
    }
}

private struct FooterProjection: Codable, Equatable {
    var durationMs: Int?
    var tools: Int
}

private struct TurnProjection: Codable, Equatable {
    var kind: String
    var id: String
    var steps: [String]
    var activity: String
    var footer: FooterProjection?

    init(_ turn: Turn) {
        switch turn {
        case .user(let id, let message):
            kind = "user"
            self.id = id
            steps = [message.id]
            activity = ""
            footer = nil
        case .golem(let id, let messages):
            kind = "golem"
            self.id = id
            steps = messages.map(\.id)
            activity = summarizeSteps(messages.flatMap { $0.tools ?? [] })
            footer = turnFooter(messages).map { FooterProjection(durationMs: $0.durationMs, tools: $0.tools) }
        }
    }
}

private struct ApprovalProjection: Codable, Equatable {
    var callId: String
    var name: String
    var source: String
    var diff: String?
}

private struct TodoProjection: Codable, Equatable {
    var id: String
    var text: String
    var status: String
}

private struct ChatProjection: Codable, Equatable {
    var busy: Bool
    var error: String?
    var notice: String?
    var runId: String?
    var runStartedAt: String?
    var approval: ApprovalProjection?
    var todos: [TodoProjection]
    var messages: [MessageProjection]
    var turns: [TurnProjection]

    init(_ state: ChatState) {
        busy = state.busy
        error = state.error
        notice = state.notice
        runId = state.runId
        runStartedAt = state.runStartedAt
        approval = state.approval.map {
            ApprovalProjection(callId: $0.callId, name: $0.name, source: $0.source, diff: $0.diff)
        }
        todos = state.todos.map { TodoProjection(id: $0.id, text: $0.text, status: $0.status.rawValue) }
        messages = state.messages.map(MessageProjection.init)
        turns = groupTurns(state.messages).map(TurnProjection.init)
    }
}

private struct GoldenCase: Decodable {
    var events: Int
    var snapshots: [ChatProjection]
}

private struct InboxItemProjection: Codable, Equatable {
    var sessionId: String
    var sessionTitle: String
    var kind: String
    var callId: String?
    var headline: String
    var source: String?
    var since: String
    var age: String
    var added: Int?
    var removed: Int?
    var helperName: String?
    var helperSessionId: String?
    var count: Int
    var answerSessionId: String
    var sent: [String]
    var notSent: [String]
    var options: [String]
    var target: [String: String]?

    init(_ item: InboxItem) {
        sessionId = item.sessionId
        sessionTitle = item.sessionTitle
        kind = item.kind.rawValue
        callId = item.callId
        headline = item.headline
        source = item.source
        since = item.since
        age = item.age
        added = item.added
        removed = item.removed
        helperName = item.helper?.name
        helperSessionId = item.helper?.sessionId
        count = item.count
        answerSessionId = item.answerSessionId
        sent = item.sent
        notSent = item.notSent
        options = inboxAnswerOptions(item).map(\.id.rawValue)
        target = answerTarget(item).map { ["sessionId": $0.sessionId, "callId": $0.callId] }
    }
}

private struct InboxGroupProjection: Codable, Equatable {
    var sessionId: String
    var waiting: Int
    var callIds: [String?]
}

private struct InboxCase: Decodable {
    var now: Double
    var sessions: [InboxSession]
    var items: [InboxItemProjection]
    var groups: [InboxGroupProjection]
    var count: Int
}

private struct RunGroupProjection: Codable, Equatable {
    var label: String
    var ids: [String]
}

private struct RunRowProjection: Codable, Equatable {
    var id: String
    var name: String
    var trigger: String
    var started: String
    var steps: String
    var line: String
    var duration: String
    var result: String
    var banner: String
    var approvals: String
}

private struct RunsCase: Decodable {
    var now: Double
    var runs: [RunLike]
    var groups: [RunGroupProjection]
    var needsYou: Int
    var rows: [RunRowProjection]
}

private struct OptionProjection: Codable, Equatable {
    var id: String
    var key: String
    var label: String
    var decision: String
    var scope: String?
}

private struct ParseProjection: Codable, Equatable {
    var ok: Bool
    var keys: [String]?
}

private struct ApprovalsCase: Decodable {
    var parse: [ParseProjection]
    var edited: [Bool]
    var options: [[OptionProjection]]
}

private struct StateCase: Decodable {
    var connection: String
    var phase: String?
    var error: Bool
    var state: String
}

private struct ViewFixture: Decodable {
    var golden: [String: GoldenCase]
    var inbox: InboxCase
    var runs: RunsCase
    var approvals: ApprovalsCase
    var golemStates: [StateCase]
}

private func loadFixture() throws -> ViewFixture {
    let url = packageFolder.appendingPathComponent("Tests/GolemKitTests/Fixtures/view-state.json")
    return try JSONDecoder().decode(ViewFixture.self, from: Data(contentsOf: url))
}

private struct GoldenLog: Decodable {
    var live: [GolemEvent]
    var replay: [GolemEvent]
}

private func loadLog(_ name: String) throws -> GoldenLog {
    try JSONDecoder().decode(GoldenLog.self, from: Data(contentsOf: goldenFolder.appendingPathComponent("\(name).json")))
}

private func fold(_ events: [GolemEvent]) -> ChatState {
    events.reduce(emptyChat, reduceChat)
}

// MARK: - The golden logs

@Test func theFixtureCoversTheSixGoldenLogs() throws {
    let fixture = try loadFixture()
    #expect(fixture.golden.keys.sorted() == ["approval", "cancel", "delegate", "failure", "plain", "tool"])
}

@Test func goldenLogsFoldToTheSameChatAsPackagesView() throws {
    let fixture = try loadFixture()
    for (name, expected) in fixture.golden.sorted(by: { $0.key < $1.key }) {
        let log = try loadLog(name)
        #expect(log.live.count == expected.events, "\(name): event count")
        var state = emptyChat
        for (index, event) in log.live.enumerated() {
            state.apply(event)
            let got = ChatProjection(state)
            if got != expected.snapshots[index] {
                Issue.record("\(name): the chat differs after event \(index) (\(event.seq ?? -1))")
                break
            }
        }
    }
}

@Test func goldenLogsFoldToTheSameTurnsAndStepMarks() throws {
    let fixture = try loadFixture()
    for (name, expected) in fixture.golden.sorted(by: { $0.key < $1.key }) {
        let state = fold(try loadLog(name).live)
        let last = try #require(expected.snapshots.last)
        #expect(groupTurns(state.messages).map(TurnProjection.init) == last.turns, "\(name): turns")
        let marks = state.messages.flatMap { $0.tools ?? [] }.map { stepMark($0).rawValue }
        #expect(marks == last.messages.flatMap(\.tools).map(\.mark), "\(name): step marks")
        #expect(!state.busy && state.approval == nil, "\(name): the run ended")
    }
}

@Test func aReplayFromZeroGivesTheLiveChat() throws {
    for name in try loadFixture().golden.keys.sorted() {
        let log = try loadLog(name)
        #expect(ChatProjection(fold(log.replay)) == ChatProjection(fold(log.live)), "\(name)")
    }
}

@Test func theApprovalLogPassesThroughAWaitingStep() throws {
    let fixture = try loadFixture()
    let snapshots = try #require(fixture.golden["approval"]).snapshots
    let waiting = snapshots.filter { $0.approval != nil }
    #expect(!waiting.isEmpty)
    #expect(waiting.allSatisfy { $0.messages.flatMap(\.tools).contains { $0.mark == "wait" } })
}

// MARK: - The Inbox

@Test func theInboxItemsGroupsAndCountMatchPackagesView() throws {
    let fixture = try loadFixture().inbox
    let items = inboxItems(fixture.sessions, now: fixture.now)
    #expect(items.map(InboxItemProjection.init) == fixture.items)
    let groups = inboxGroups(fixture.sessions, now: fixture.now).map {
        InboxGroupProjection(sessionId: $0.sessionId, waiting: $0.waiting, callIds: $0.items.map(\.callId))
    }
    #expect(groups == fixture.groups)
    #expect(inboxCount(items) == fixture.count)
}

@Test func needsYouIsOldestFirst() throws {
    let fixture = try loadFixture().inbox
    let parsed = inboxItems(fixture.sessions, now: fixture.now).compactMap { parseTime($0.since) }
    #expect(parsed == parsed.sorted())
}

// MARK: - Runs

@Test func theRunGroupsAndRowsMatchPackagesView() throws {
    let fixture = try loadFixture().runs
    let groups = runGroups(fixture.runs, now: fixture.now, calendar: utc).map {
        RunGroupProjection(label: $0.label.rawValue, ids: $0.items.map(\.sessionId))
    }
    #expect(groups == fixture.groups)
    #expect(needsYouCount(fixture.runs) == fixture.needsYou)
    let rows = fixture.runs.map { run in
        RunRowProjection(
            id: run.sessionId, name: runName(run), trigger: runTriggerWords(run),
            started: runStartedText(run, now: fixture.now, calendar: utc), steps: runStepsWords(run),
            line: runRowLine(run, now: fixture.now, calendar: utc), duration: runDuration(run, now: fixture.now),
            result: runResultLine(run), banner: runBannerText(run, now: fixture.now, calendar: utc),
            approvals: approvalsWords(run.approvals ?? 0)
        )
    }
    #expect(rows == fixture.rows)
}

// MARK: - Approvals and the state words

@Test func approvalArgsMatchPackagesView() throws {
    let fixture = try loadFixture().approvals
    let texts = [#"{"path": "a.txt"}"#, "[1]", "nope", #""text""#, "null", "{}"]
    let parsed = texts.map { text -> ParseProjection in
        if case .ok(let args) = parseArgs(text) { return ParseProjection(ok: true, keys: args.keys.sorted()) }
        return ParseProjection(ok: false, keys: nil)
    }
    #expect(parsed == fixture.parse)
    let a = try arguments(#"{"a": 1, "b": 2}"#)
    #expect((editedArgs(original: a, args: try arguments(#"{"b": 2, "a": 1}"#)) == nil) == fixture.edited[0])
    #expect((editedArgs(original: a, args: try arguments(#"{"a": 1, "b": 3}"#)) == nil) == fixture.edited[1])
    let contexts = [
        ApprovalAnswerContext(helper: false), ApprovalAnswerContext(helper: true),
        ApprovalAnswerContext(helper: true, count: 3), ApprovalAnswerContext(helper: true, siblings: 2),
    ]
    let options = contexts.map { context in
        approvalAnswerOptions(context).map {
            OptionProjection(id: $0.id.rawValue, key: $0.key, label: $0.label, decision: $0.decision.rawValue, scope: $0.scope)
        }
    }
    #expect(options == fixture.options)
}

private func arguments(_ json: String) throws -> [String: JSONAny] {
    try JSONDecoder().decode([String: JSONAny].self, from: Data(json.utf8))
}

@Test func golemStateMatchesPackagesView() throws {
    for item in try loadFixture().golemStates {
        let state = golemState(connected: item.connection == "connected", phase: item.phase.flatMap(RunPhase.init), error: item.error)
        #expect(state.rawValue == item.state, "\(item.connection) \(item.phase ?? "-") \(item.error)")
    }
}

// MARK: - Cases the golden logs do not hold

private func event(_ type: String, seq: Int, session: String = "s1", run: String? = "r1", data: String) throws -> GolemEvent {
    let runJSON = run.map { "\"\($0)\"" } ?? "null"
    let json = #"{"type":"\#(type)","seq":\#(seq),"session_id":"\#(session)","run_id":\#(runJSON),"ts":"2026-01-01T00:00:0\#(seq)Z","data":\#(data)}"#
    return try JSONDecoder().decode(GolemEvent.self, from: Data(json.utf8))
}

@Test func aHelpersLegacyEventsLeaveTheLeadsTranscriptAlone() throws {
    var state = emptyChat
    state.apply(try event("message.started", seq: 1, data: #"{"message_id":"m1","role":"assistant"}"#))
    state.apply(try event("tool.requested", seq: 2, data: #"{"call_id":"c1","message_id":"m1","name":"delegate","args":{}}"#))
    state.apply(try event("tool.requested", seq: 3, data: #"{"call_id":"k1","message_id":"m1","name":"shell","args":{},"parent_call_id":"c1"}"#))
    state.apply(try event("tool.completed", seq: 4, data: #"{"call_id":"k1","summary":"x","preview":"","parent_call_id":"c1"}"#))
    state.apply(try event("tool.failed", seq: 5, data: #"{"call_id":"c1","message":"x","parent_call_id":"c1"}"#))
    #expect(state.messages[0].tools?.map(\.callId) == ["c1"])
    #expect(state.messages[0].tools?[0].status == .requested)
}

@Test func anApprovalWaitsThenIsAnsweredWithEditedArguments() throws {
    var state = emptyChat
    state.apply(try event("run.started", seq: 1, data: "{}"))
    state.apply(try event("message.started", seq: 2, data: #"{"message_id":"m1","role":"assistant"}"#))
    state.apply(try event("tool.requested", seq: 3, data: #"{"call_id":"c1","message_id":"m1","name":"shell","args":{"cmd":"ls"}}"#))
    state.apply(try event("approval.needed", seq: 4, data: #"{"call_id":"c1","name":"shell","args":{"cmd":"ls"},"source":"rule"}"#))
    #expect(state.approval?.callId == "c1" && state.busy)
    #expect(stepMark(try #require(state.messages[0].tools?.first)) == .wait)
    state.apply(try event("approval.resolved", seq: 5, data: #"{"call_id":"c1","name":"shell","decision":"allow","args":{"cmd":"pwd"}}"#))
    let tool = try #require(state.messages[0].tools?.first)
    #expect(state.approval == nil)
    #expect(tool.status == .requested && tool.approval?.answer?.edited == true && tool.approval?.answer?.decision == .allow)
    #expect(tool.args["cmd"]?.value as? String == "pwd")
}

@Test func aFailedRunShowsItsMessageAndAShutdownCancelIsNoticed() throws {
    var state = emptyChat
    state.apply(try event("run.started", seq: 1, data: "{}"))
    state.apply(try event("run.failed", seq: 2, data: #"{"message":"no key","hint":"set one","code":"auth_failed"}"#))
    #expect(state.error == "no key \u{b7} set one \u{b7} \(SWITCH_HINT)" && !state.busy)
    state.apply(try event("run.started", seq: 3, data: "{}"))
    #expect(state.error == nil)
    state.apply(try event("run.cancelled", seq: 4, data: #"{"reason":"shutdown"}"#))
    #expect(state.notice == SHUTDOWN_NOTICE)
}

@Test func toolOutputKeepsTheTailAndGoesWhenTheCallEnds() throws {
    var state = emptyChat
    state.apply(try event("message.started", seq: 1, data: #"{"message_id":"m1","role":"assistant"}"#))
    state.apply(try event("tool.requested", seq: 2, data: #"{"call_id":"c1","message_id":"m1","name":"shell","args":{}}"#))
    let chunk = String(repeating: "x", count: 3_000)
    state.apply(try event("tool.output", seq: 3, data: #"{"call_id":"c1","text":"\#(chunk)"}"#))
    state.apply(try event("tool.output", seq: 4, data: #"{"call_id":"c1","text":"\#(chunk)"}"#))
    #expect(state.messages[0].tools?[0].output?.count == LIVE_OUTPUT_CHARS)
    state.apply(try event("tool.completed", seq: 5, data: #"{"call_id":"c1","summary":"s","preview":"p","failed":true}"#))
    let tool = try #require(state.messages[0].tools?.first)
    #expect(tool.output == nil && stepMark(tool) == .deny)
}

@Test func theActivityLineGroupsToolsByKind() {
    func tool(_ name: String, _ status: ToolStatus, unsuccessful: Bool = false) -> ToolBlock {
        var block = ToolBlock(callId: UUID().uuidString, name: name, args: [:], status: status)
        block.unsuccessful = unsuccessful
        return block
    }
    var asked = tool("shell", .done)
    asked.approval = ToolApproval(source: "rule", subject: nil, answer: nil)
    let line = summarizeSteps([
        tool("web_search", .done), tool("read_file", .done), tool("read_file", .done),
        tool("mcp__github__get_me", .done), tool("mcp__github__list", .failed), asked, tool("shell", .done, unsuccessful: true),
    ])
    #expect(line == "searched the web \u{b7} read 2 files \u{b7} 2 github calls, 1 failed \u{b7} ran 2 commands, 1 failed \u{b7} 1 approval")
    #expect(displayToolName("mcp__github__get_me") == "github \u{b7} get_me")
    #expect(summarizeSteps([]) == "")
}

@Test func sessionsGroupByWhenTheyLastChanged() {
    let now = parseTime("2026-11-14T10:00:00Z")!
    let sessions = [
        InboxSession(sessionId: "old", status: "idle", updatedAt: "2026-10-01T10:00:00Z"),
        InboxSession(sessionId: "today", status: "idle", updatedAt: "2026-11-14T01:00:00Z"),
        InboxSession(sessionId: "yesterday", status: "idle", updatedAt: "2026-11-13T23:00:00Z"),
        InboxSession(sessionId: "week", status: "idle", updatedAt: "2026-11-09T12:00:00Z"),
        InboxSession(sessionId: "bad", status: "idle", updatedAt: "soon"),
        InboxSession(sessionId: "later", status: "idle", updatedAt: "2026-11-14T09:00:00Z"),
    ]
    let groups = groupByTime(sessions, now: now, calendar: utc) { $0.updatedAt }
    #expect(groups.map { $0.label.rawValue } == ["Today", "Yesterday", "Previous 7 days", "Earlier"])
    #expect(groups.map { $0.items.map(\.sessionId) } == [["later", "today"], ["yesterday"], ["week"], ["old", "bad"]])
}

// MARK: - The observable models

@MainActor @Test func aTranscriptModelFollowsItsSessionOnly() async throws {
    let model = TranscriptModel(sessionID: "s1")
    let events = [
        try event("run.started", seq: 1, data: "{}"),
        try event("message.completed", seq: 2, data: #"{"message_id":"u1","role":"user","text":"hi"}"#),
        try event("message.completed", seq: 3, session: "other", data: #"{"message_id":"x","role":"user","text":"no"}"#),
        try event("message.started", seq: 4, data: #"{"message_id":"a1","role":"assistant"}"#),
        try event("message.delta", seq: 5, data: #"{"message_id":"a1","text":"hello"}"#),
        try event("todos.updated", seq: 6, data: #"{"todos":[{"id":"1","text":"one","status":"in_progress"}]}"#),
    ]
    let (stream, continuation) = AsyncStream<GolemEvent>.makeStream()
    for event in events { continuation.yield(event) }
    continuation.finish()
    await model.follow(stream)
    #expect(model.chat.messages.map(\.id) == ["u1", "a1"])
    #expect(model.chat.messages[1].text == "hello" && model.chat.messages[1].streaming)
    #expect(model.turns.count == 2)
    #expect(model.chat.todos.map(\.text) == ["one"] && todoSummary(model.chat.todos) == "todos 0/1 \u{b7} one")
    #expect(model.golemState(connected: true) == .thinking)
    #expect(model.golemState(connected: false) == .offline)
}

@MainActor @Test func theInboxModelGroupsNeedsYouRunningAndToday() throws {
    let now = parseTime("2026-11-14T10:00:00Z")!
    let sessions = SessionListModel()
    sessions.replace(with: [
        InboxSession(sessionId: "a", title: "A", status: "waiting", pending: InboxPending(
            kind: .approval, since: "2026-11-14T09:00:00Z", callId: "c1", name: "shell", subject: "ls", source: "rule")),
        InboxSession(sessionId: "b", title: "B", status: "waiting", pending: InboxPending(
            kind: .approval, since: "2026-11-14T08:00:00Z", callId: "c2", name: "read_file", subject: "/x", source: "rule")),
    ])
    let runs = RunsModel()
    runs.replace(with: [
        RunLike(sessionId: "a", routine: "sentry", status: .waiting, startedAt: "2026-11-14T08:50:00Z", approvals: 1),
        RunLike(sessionId: "review", routine: "pr-digest", status: .waiting, startedAt: "2026-11-14T09:00:00Z"),
        RunLike(sessionId: "run", routine: "receipts", status: .running, startedAt: "2026-11-14T09:59:00Z"),
        RunLike(sessionId: "done", routine: "brief", status: .succeeded, startedAt: "2026-11-14T08:30:00Z"),
        RunLike(sessionId: "old", routine: "brief", status: .succeeded, startedAt: "2026-11-13T08:30:00Z"),
    ])
    let model = InboxModel(sessions: sessions, runs: runs)
    let inbox = model.inbox(now: now, calendar: utc)
    #expect(inbox.needsYou.map(\.callId) == ["c2", "c1"])
    #expect(inbox.reviews.map(\.sessionId) == ["review"])
    #expect(inbox.running.map(\.sessionId) == ["run"])
    #expect(inbox.today.map(\.sessionId) == ["done"])
    #expect(inbox.needsYouCount == 3)
    #expect(model.pendingApprovals(now: now).count == 2)
    sessions.remove(sessionID: "a")
    #expect(model.pendingApprovals(now: now).map(\.callId) == ["c2"])
}

@Test func aSummaryOfAGeneratedTypeConverts() throws {
    let json = #"""
    {"session_id":"s","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:01Z","last_seq":3,
     "model_profile":"remote","status":"waiting","title":"T",
     "pending_items":[{"kind":"approval","since":"2026-01-01T00:00:01Z","call_id":"c","name":"shell","subject":"ls",
       "helper":{"session_id":"h","agent":"worker","index":1},"count":2}]}
    """#
    let summary = try JSONDecoder().decode(SessionSummary.self, from: Data(json.utf8))
    let session = try InboxSession(summary: summary)
    #expect(session.sessionId == "s" && session.status == "waiting" && session.updatedAt == "2026-01-01T00:00:01Z")
    let item = try #require(inboxItems([session], now: parseTime("2026-01-01T00:05:00Z")!).first)
    #expect(item.helper?.name == "worker" && item.count == 2 && item.age == "4m" && item.answerSessionId == "h")
    let info = try JSONDecoder().decode(RunInfo.self, from: Data(
        #"{"kind":"ask","origin":"cli","session_id":"s","status":"running","started_at":"2026-01-01T00:00:00Z"}"#.utf8))
    #expect(try RunLike(info: info).status == .running)
    let bare = try JSONDecoder().decode(RunInfo.self, from: Data(
        #"{"kind":"workflow","origin":"workflow:a","status":"running","workflow_run_id":"wr_1"}"#.utf8))
    #expect(try RunLike(info: bare).sessionId == "wr_1")
}

// MARK: - The badge

@MainActor
@Test func theBadgeCountsAskersLikeTheWebSidebarAndIgnoresReviews() {
    let sessions = SessionListModel()
    let ask = InboxPending(kind: .approval, since: "2026-11-21T10:00:00Z", callId: "c1", name: "shell", subject: "ls")
    let shared = InboxPending(kind: .approval, since: "2026-11-21T10:01:00Z", callId: "c2", name: "shell", subject: "pwd", count: 3)
    sessions.replace(with: [
        InboxSession(sessionId: "a", title: "A", status: "waiting", pending: ask),
        InboxSession(sessionId: "b", title: "B", status: "waiting", pending: shared),
        InboxSession(sessionId: "c", title: "C", status: "closed", pending: ask),
    ])
    let runs = RunsModel()
    runs.replace(with: [RunLike(sessionId: "r", status: .waiting, approvals: 1)])
    let model = InboxModel(sessions: sessions, runs: runs)
    #expect(model.badgeCount(now: nowMilliseconds()) == 4)
    #expect(model.inbox(now: nowMilliseconds()).needsYouCount == 5)
}
