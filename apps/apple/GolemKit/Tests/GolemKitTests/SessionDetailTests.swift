import Foundation
import Testing
@testable import GolemKit

// The session view's model against the scripted Mac: attach folds the replay, a reply and a cancel
// reach the Mac, a new task makes the session and sends the text, and closing detaches.

private func waitFor(
    _ what: String, seconds: Double = 10, sourceLocation: SourceLocation = #_sourceLocation,
    _ check: () async -> Bool
) async {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if await check() { return }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    Issue.record("timed out waiting for \(what)", sourceLocation: sourceLocation)
}

/// A relay, a scripted Mac that has joined it, and a device key the Mac allows.
private struct SessionRig {
    let relay: RelayProcess
    let mac: ScriptedMac
    let connection: Connection

    static func make() async throws -> SessionRig {
        let relay = try RelayProcess()
        try await relay.waitUntilHealthy()
        let mac = ScriptedMac()
        let key = InMemoryDeviceKey()
        await mac.setAllowed([key.publicKey])
        try await mac.start(relayURL: relay.url)
        return SessionRig(relay: relay, mac: mac, connection: Connection(config: await mac.config(relayURL: relay.url), key: key))
    }

    func shutdown() async {
        await connection.stop()
        await mac.stop()
        relay.stop()
    }
}

private func message(_ id: String, role: String, text: String) -> [String: Any] {
    ["message_id": id, "role": role, "text": text, "interrupted": false, "skill": NSNull(), "thinking": NSNull(),
     "thinking_ms": NSNull()]
}

private func session(_ id: String, cwd: String?, at: String) -> InboxSession {
    var row = InboxSession(sessionId: id, status: "idle", updatedAt: at)
    row.cwd = cwd
    return row
}

@Test func recentFoldersAreNewestFirstAndEachOnce() {
    let folders = recentFolders([
        session("a", cwd: "~/code/old", at: "2026-11-20T10:00:00Z"),
        session("b", cwd: "~/code/shop", at: "2026-11-21T10:00:00Z"),
        session("c", cwd: "~/code/old", at: "2026-11-21T11:00:00Z"),
        session("d", cwd: nil, at: "2026-11-21T12:00:00Z"),
        session("e", cwd: "", at: "2026-11-21T12:30:00Z"),
    ])
    #expect(folders == ["~/code/old", "~/code/shop"])
}

@Test func markdownDrawsInlineStyleAndKeepsLineBreaks() {
    let text = markdownText("**Good** morning\nsecond line")
    #expect(String(text.characters) == "Good morning\nsecond line")
    #expect(text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    #expect(String(markdownText("").characters).isEmpty)
}

@Test func theResultIsTheLastFinishedReplyWithText() {
    func reply(_ id: String, _ text: String, streaming: Bool = false) -> ChatMessage {
        ChatMessage(id: id, role: .assistant, text: text, streaming: streaming)
    }
    let user = ChatMessage(id: "u", role: .user, text: "hi", streaming: false)
    #expect(lastResult([user]) == nil)
    #expect(lastResult([user, reply("a", "one"), reply("b", "")])?.id == "a")
    #expect(lastResult([user, reply("a", "one"), reply("b", "tw", streaming: true)]) == nil)
}

@Suite(.serialized, .timeLimit(.minutes(1)), .enabled(if: RelayProcess.bunPath != nil, "bun is not installed, so the relay cannot run"))
struct SessionDetailTests {
    @Test @MainActor func attachingFoldsTheReplayAndLiveEventsAndClosingDetaches() async throws {
        let rig = try await SessionRig.make()
        await rig.mac.record(session: "s1", type: "message.completed", data: message("m1", role: "user", text: "read notes"))
        await rig.mac.record(session: "s1", type: "run.started", data: [:])
        await rig.mac.record(session: "s1", type: "message.started", data: ["message_id": "m2", "role": "assistant"])
        await rig.mac.record(session: "s1", type: "tool.requested", data: [
            "call_id": "c1", "message_id": "m2", "name": "read_file", "args": ["path": "notes.txt"], "parent_call_id": NSNull(),
        ])
        await rig.mac.record(session: "s1", type: "todos.updated", data: [
            "todos": [["id": "t1", "text": "read it", "status": "in_progress"]],
        ])
        await rig.connection.start()
        await waitFor("connected") { await rig.connection.state == .connected }

        let model = SessionDetailModel(sessionID: "s1", title: "Notes", channel: ConnectionSessionChannel(connection: rig.connection))
        let task = Task { await model.run() }
        await waitFor("the replay") { await MainActor.run { model.chat.messages.count == 2 } }
        #expect(model.load == .ready)
        #expect(model.chat.messages[1].tools?.first?.name == "read_file")
        #expect(model.chat.todos.map(\.text) == ["read it"])
        #expect(model.chat.busy)
        #expect(model.result == nil)

        await rig.mac.record(session: "s1", type: "message.completed", data: message("m2", role: "assistant", text: "It says **42**."))
        await rig.mac.record(session: "s1", type: "run.completed", data: [:])
        await waitFor("the answer") { await MainActor.run { model.result?.text == "It says **42**." } }
        #expect(!model.chat.busy)

        task.cancel()
        await task.value
        await waitFor("the detach") { await rig.mac.detachCalls == ["s1"] }
        await rig.shutdown()
    }

    @Test @MainActor func aReplyAndACancelReachTheMac() async throws {
        let rig = try await SessionRig.make()
        await rig.mac.record(session: "s1", type: "run.started", runId: "run-9", data: [:])
        await rig.connection.start()
        await waitFor("connected") { await rig.connection.state == .connected }
        let model = SessionDetailModel(sessionID: "s1", title: "Notes", channel: ConnectionSessionChannel(connection: rig.connection))
        let task = Task { await model.run() }
        await waitFor("the run") { await MainActor.run { model.chat.runId == "run-9" } }

        model.draft = "   "
        #expect(!model.canSend)
        model.draft = "  and the second file?  "
        #expect(model.canSend)
        await model.send()
        #expect(model.draft.isEmpty)
        #expect(model.actionError == nil)
        let sent = try #require(await rig.mac.sendCalls.first)
        #expect(sent["session_id"] as? String == "s1")
        #expect(sent["text"] as? String == "and the second file?")

        await model.cancelRun()
        let cancelled = try #require(await rig.mac.cancelCalls.first)
        #expect(cancelled["run_id"] as? String == "run-9")

        task.cancel()
        await rig.shutdown()
    }

    @Test @MainActor func aFailedSendKeepsTheDraftAndSaysWhy() async throws {
        let rig = try await SessionRig.make()
        // Not connected: the call fails at once.
        let model = SessionDetailModel(sessionID: "s1", title: "Notes", channel: ConnectionSessionChannel(connection: rig.connection))
        model.draft = "hello"
        await model.send()
        #expect(model.draft == "hello")
        #expect(model.actionError == "Your Mac is not reachable.")
        #expect(!model.isSending)
        await rig.shutdown()
    }

    @Test @MainActor func aNewTaskMakesTheSessionInTheFolderThenSendsTheText() async throws {
        let rig = try await SessionRig.make()
        await rig.connection.start()
        await waitFor("connected") { await rig.connection.state == .connected }
        let task = NewTaskModel(folders: ["~/code/shop", "~/code/old"], channel: ConnectionSessionChannel(connection: rig.connection))
        #expect(task.folder == "~/code/shop")
        #expect(!task.canStart)
        task.folder = "~/code/old"
        task.text = " Fix the flaky test "
        let id = await task.start()
        #expect(id == "new-1")
        let created = try #require(await rig.mac.createCalls.first)
        #expect(created["cwd"] as? String == "~/code/old")
        #expect(created["origin"] as? String == "user")
        let sent = try #require(await rig.mac.sendCalls.first)
        #expect(sent["session_id"] as? String == "new-1")
        #expect(sent["text"] as? String == "Fix the flaky test")
        await rig.shutdown()
    }

    @Test @MainActor func aNewTaskThatCannotReachTheMacSaysSo() async throws {
        let rig = try await SessionRig.make()
        let task = NewTaskModel(folders: [], channel: ConnectionSessionChannel(connection: rig.connection))
        #expect(task.folder == nil)
        task.text = "hello"
        let id = await task.start()
        #expect(id == nil)
        #expect(task.error == "Your Mac is not reachable.")
        await rig.shutdown()
    }
}
