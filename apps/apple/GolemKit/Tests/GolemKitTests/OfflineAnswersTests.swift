import Foundation
import Testing
@testable import GolemKit

private func eventually(
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

/// A relay, a scripted Mac, and the app's side of an offline answer.
@MainActor
private final class Rig {
    let relay: RelayProcess
    let mac = ScriptedMac()
    let connection: Connection
    let pending = PendingAnswers()
    let channel: ConnectionApprovalChannel

    init() async throws {
        relay = try RelayProcess()
        try await relay.waitUntilHealthy()
        let key = InMemoryDeviceKey()
        await mac.setAllowed([key.publicKey])
        try await mac.start(relayURL: relay.url)
        connection = Connection(config: await mac.config(relayURL: relay.url), key: key)
        channel = ConnectionApprovalChannel(connection: connection, pending: pending)
        pending.follow(await connection.outboxOutcomes())
    }

    /// The link up, then the Mac asleep.
    func goOffline() async {
        await connection.start()
        await eventually("connected") { await connection.state == .connected }
        await mac.stop()
        await eventually("macUnreachable") { await connection.state == .macUnreachable }
    }

    func answer(_ callId: String, _ decision: Decision = .allow) async {
        await #expect(throws: ApprovalFailure.queued) {
            try await self.channel.respond(sessionId: "s1", callId: callId, decision: decision)
        }
    }

    func sheet(callId: String, tool: String, authenticator: any ApprovalAuthenticator) -> ApprovalSheetModel {
        let pending = PendingApproval(callId: callId, name: tool, args: [:], source: "built-in default", diff: nil)
        let request = ApprovalRequest(pending: pending, sessionId: "s1", origin: "Fix it", folder: nil)
        return ApprovalSheetModel(request: request, deviceName: "iPhone", authenticator: authenticator, channel: channel)
    }

    func shutdown() async {
        pending.stopFollowing()
        await connection.stop()
        await mac.stop()
        relay.stop()
    }
}

private final class CountingAuthenticator: ApprovalAuthenticator, @unchecked Sendable {
    let passes: Bool
    private let lock = NSLock()
    private var count = 0
    init(passes: Bool = true) { self.passes = passes }
    var asked: Int { lock.withLock { count } }
    func isAvailable() -> Bool { true }
    func confirm(reason: String) async -> Bool {
        lock.withLock { count += 1 }
        return passes
    }
}

@MainActor
@Suite struct OfflineAnswersTests {
    @Test func anAnswerGivenOfflineWaitsThenIsDeliveredOnce() async throws {
        let rig = try await Rig()
        await rig.goOffline()
        await rig.answer("c1")
        #expect(rig.pending.answer(for: "c1")?.status == .waiting)
        #expect(rig.pending.waitingCount == 1)
        // Answering again while it waits does not queue it twice.
        await rig.answer("c1", .deny)
        #expect(await rig.connection.outboxCount == 1)

        try await rig.mac.start(relayURL: rig.relay.url)
        await eventually("delivered") { rig.pending.answer(for: "c1") == nil }
        try await Task.sleep(nanoseconds: 300_000_000)
        let calls = await rig.mac.approvals
        #expect(calls.count == 1)
        #expect(calls.first?["decision"] as? String == "allow")
        #expect(await rig.connection.outboxCount == 0)
        await rig.shutdown()
    }

    @Test func answersGoOutInTheOrderTheyWereGiven() async throws {
        let rig = try await Rig()
        await rig.goOffline()
        for id in ["c1", "c2", "c3"] { await rig.answer(id) }
        try await rig.mac.start(relayURL: rig.relay.url)
        await eventually("all delivered") { rig.pending.answers.isEmpty }
        #expect(await rig.mac.approvals.compactMap { $0["call_id"] as? String } == ["c1", "c2", "c3"])
        await rig.shutdown()
    }

    @Test func aQuestionAnsweredOnTheMacMeanwhileGivesTheFriendlyState() async throws {
        let rig = try await Rig()
        await rig.goOffline()
        await rig.answer("c1")
        await rig.mac.answerElsewhere("c1")
        try await rig.mac.start(relayURL: rig.relay.url)
        await eventually("refused") { rig.pending.answer(for: "c1")?.status == .answeredOnMac }
        #expect(rig.pending.answer(for: "c1")?.rowText == "Answered on the Mac")
        #expect(rig.pending.waitingCount == 0)
        // Once its question has left the Inbox it is forgotten.
        rig.pending.prune(keeping: ["c1"])
        #expect(rig.pending.answer(for: "c1") != nil)
        rig.pending.prune(keeping: [])
        #expect(rig.pending.answer(for: "c1") == nil)
        await rig.shutdown()
    }

    @Test func aSecondSendOfAnAppliedAnswerIsRefusedNotAppliedTwice() async throws {
        let rig = try await Rig()
        await rig.goOffline()
        await rig.answer("c1")
        // The Mac applied the answer, but the reply never reached the phone, so the phone sends it again.
        await rig.mac.answerElsewhere("c1")
        try await rig.mac.start(relayURL: rig.relay.url)
        await eventually("refused") { rig.pending.answer(for: "c1")?.status == .answeredOnMac }
        #expect(await rig.mac.answeredCalls == ["c1"])
        await rig.shutdown()
    }

    @Test func theSheetClosesWithWaitingToSendWhenTheMacIsAway() async throws {
        let rig = try await Rig()
        await rig.goOffline()
        let sheet = rig.sheet(callId: "c1", tool: "read_file", authenticator: CountingAuthenticator())
        await sheet.allowOnce()
        #expect(sheet.phase == .queued(.allow))
        #expect(sheet.isClosing)
        #expect(sheet.closingText == "Waiting to send")
        await rig.shutdown()
    }

    @Test func faceIDIsAskedBeforeAnAnswerIsQueued() async throws {
        let rig = try await Rig()
        await rig.goOffline()
        let refuses = CountingAuthenticator(passes: false)
        let sheet = rig.sheet(callId: "c1", tool: "shell", authenticator: refuses)
        await sheet.allowOnce()
        #expect(refuses.asked == 1)
        #expect(sheet.phase == .ready)
        #expect(rig.pending.answers.isEmpty)
        #expect(await rig.connection.outboxCount == 0)

        let proves = CountingAuthenticator()
        let second = rig.sheet(callId: "c2", tool: "shell", authenticator: proves)
        await second.alwaysAllow()
        #expect(proves.asked == 1)
        #expect(second.phase == .queued(.allowAlways))
        await rig.shutdown()
    }
}

@Suite struct OfflineBannerTests {
    @Test func eachStateHasItsBanner() {
        let mac = OfflineBanner.make(state: .macUnreachable, networkAvailable: true, waiting: 0)
        #expect(mac?.title == "Can't reach your Mac")
        #expect(mac?.detail == "Your Mac is asleep or offline. Answers will be sent when it is back.")
        #expect(OfflineBanner.make(state: .relayUnreachable, networkAvailable: true, waiting: 0)?.cause == .relayUnreachable)
        #expect(OfflineBanner.make(state: .relayUnreachable, networkAvailable: false, waiting: 0)?.cause == .noNetwork)
        #expect(OfflineBanner.make(state: .connected, networkAvailable: true, waiting: 0) == nil)
        #expect(OfflineBanner.make(state: .connecting, networkAvailable: true, waiting: 0) == nil)
        #expect(OfflineBanner.make(state: .stopped(.revoked), networkAvailable: false, waiting: 0) == nil)
    }

    @Test func theBannerCountsWaitingAnswers() {
        let one = OfflineBanner.make(state: .macUnreachable, networkAvailable: true, waiting: 1)
        #expect(one?.detail.hasSuffix("1 answer waits.") == true)
        let two = OfflineBanner.make(state: .macUnreachable, networkAvailable: true, waiting: 2)
        #expect(two?.detail.hasSuffix("2 answers wait.") == true)
    }

    @Test func staleTimeIsShownAsUpdated() {
        #expect(OfflineBanner.updatedText(nil) == nil)
        #expect(OfflineBanner.updatedText(Date())?.hasPrefix("Updated ") == true)
    }
}
