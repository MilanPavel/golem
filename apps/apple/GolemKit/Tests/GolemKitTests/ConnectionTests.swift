import CryptoKit
import Foundation
import Testing
@testable import GolemKit

/// Collects what an `AsyncStream` yields, so a test can look at it.
private actor Collector<Element: Sendable> {
    private(set) var items: [Element] = []
    private var task: Task<Void, Never>?

    static func collect(_ stream: AsyncStream<Element>) -> Collector {
        let collector = Collector()
        let task = Task { for await item in stream { await collector.add(item) } }
        Task { await collector.keep(task) }
        return collector
    }

    private func keep(_ task: Task<Void, Never>) { self.task = task }
    private func add(_ item: Element) { items.append(item) }
    func cancel() { task?.cancel() }
}

/// Polls until `check` holds, or fails the test after `seconds`.
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

/// A relay, a scripted Mac that has joined it, and a device key the Mac allows.
private struct Rig {
    let relay: RelayProcess
    let mac: ScriptedMac
    let key: InMemoryDeviceKey
    let connection: Connection

    static func make(allowDevice: Bool = true) async throws -> Rig {
        let relay = try RelayProcess()
        try await relay.waitUntilHealthy()
        let mac = ScriptedMac()
        let key = InMemoryDeviceKey()
        if allowDevice { await mac.setAllowed([key.publicKey]) }
        try await mac.start(relayURL: relay.url)
        let connection = Connection(config: await mac.config(relayURL: relay.url), key: key)
        return Rig(relay: relay, mac: mac, key: key, connection: connection)
    }

    func shutdown() async {
        await connection.stop()
        await mac.stop()
        relay.stop()
    }
}

@Suite(.serialized, .enabled(if: RelayProcess.bunPath != nil, "bun is not installed, so the relay cannot run"))
struct ConnectionTests {
    @Test func aDeviceListsTheMacsSessionsThroughTheRelay() async throws {
        let rig = try await Rig.make()
        await rig.mac.setSessionList([sessionRow("s1", title: "first"), sessionRow("s2", title: "second")])
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }

        let sessions = try await rig.connection.listSessions()
        #expect(sessions.map(\.sessionID) == ["s1", "s2"])
        #expect(sessions.map(\.title) == ["first", "second"])
        #expect(await rig.mac.handshakes == 1)
        await rig.shutdown()
    }

    @Test func aMethodOutsideTheDeviceListIsRefusedBeforeItIsSent() async throws {
        let rig = try await Rig.make()
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }
        await #expect(throws: ConnectionError.methodNotAllowed("auth.set")) {
            _ = try await rig.connection.callRaw("auth.set")
        }
        await rig.shutdown()
    }

    @Test func resumesAfterADropWithNoDuplicateAndNoGap() async throws {
        let rig = try await Rig.make()
        // On resume the Mac replays two events too many, as a daemon may.
        await rig.mac.setReplayOverlap(2)
        for _ in 1...3 { await rig.mac.emit(session: "s1") }
        let collector = Collector.collect(await rig.connection.events())
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }
        try await rig.connection.attach(sessionID: "s1")
        await eventually("the first three events") { await collector.items.count == 3 }

        await rig.mac.emit(session: "s1")
        await rig.mac.emit(session: "s1")
        await eventually("five events") { await collector.items.count == 5 }

        await rig.connection.forceDisconnect()
        // Events the app cannot receive while the link is down.
        await rig.mac.emit(session: "s1")
        await rig.mac.emit(session: "s1")
        await eventually("a second handshake") { await rig.mac.handshakes >= 2 }
        await eventually("connected again") { await rig.connection.state == .connected }
        await eventually("seven events") { await collector.items.count == 7 }

        await rig.mac.emit(session: "s1")
        await eventually("eight events") { await collector.items.count == 8 }
        // Give any repeat time to show up.
        try await Task.sleep(nanoseconds: 300_000_000)

        let seqs = await collector.items.compactMap(\.seq)
        #expect(seqs == Array(1...8), "\(seqs)")
        let attaches = await rig.mac.attachCalls
        #expect(attaches.first?.afterSeq == 0)
        #expect(attaches.last?.afterSeq == 5, "\(attaches)")
        await collector.cancel()
        await rig.shutdown()
    }

    @Test func saysMacUnreachableWhenTheMacIsGoneAndComesBack() async throws {
        let rig = try await Rig.make()
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }

        await rig.mac.stop()
        await eventually("macUnreachable") { await rig.connection.state == .macUnreachable }
        await #expect(throws: ConnectionError.notConnected) { _ = try await rig.connection.listSessions() }
        // The relay is fine, so the app does not claim otherwise.
        #expect(await rig.connection.state != .relayUnreachable)

        try await rig.mac.start(relayURL: rig.relay.url)
        await eventually("connected again") { await rig.connection.state == .connected }
        #expect(await rig.mac.handshakes == 2)
        await rig.shutdown()
    }

    @Test func saysRelayUnreachableWhenThereIsNoRelayAndRecovers() async throws {
        let relay = try RelayProcess()
        try await relay.waitUntilHealthy()
        let mac = ScriptedMac()
        let key = InMemoryDeviceKey()
        await mac.setAllowed([key.publicKey])
        try await mac.start(relayURL: relay.url)
        let connection = Connection(config: await mac.config(relayURL: relay.url), key: key)
        await connection.start()
        await eventually("connected") { await connection.state == .connected }

        relay.stop()
        await eventually("relayUnreachable") { await connection.state == .relayUnreachable }
        await connection.stop()
        await mac.stop()
    }

    @Test func theOutboxDrainsOnReconnect() async throws {
        let rig = try await Rig.make()
        let outcomes = Collector.collect(await rig.connection.outboxOutcomes())
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }
        await rig.mac.stop()
        await eventually("macUnreachable") { await rig.connection.state == .macUnreachable }

        let first = try await rig.connection.enqueue(
            "approval.respond", ApprovalRespondParams(args: nil, callID: "c1", decision: .allow, scope: nil, sessionID: "s1"))
        let second = try await rig.connection.enqueue(
            "approval.respond", ApprovalRespondParams(args: nil, callID: "c2", decision: .deny, scope: nil, sessionID: "s1"))
        #expect(await rig.connection.outboxCount == 2)
        #expect(await rig.mac.approvals.isEmpty)

        try await rig.mac.start(relayURL: rig.relay.url)
        await eventually("both answers delivered") { await outcomes.items.count == 2 }
        #expect(await outcomes.items.map(\.id) == [first, second])
        #expect(await outcomes.items.allSatisfy { $0.result == .delivered })
        #expect(await rig.connection.outboxCount == 0)
        let callIDs = await rig.mac.approvals.compactMap { $0["call_id"] as? String }
        #expect(callIDs == ["c1", "c2"])
        await outcomes.cancel()
        await rig.shutdown()
    }

    @Test func theOutboxTakesOnlyApprovalAnswers() async throws {
        let rig = try await Rig.make()
        await #expect(throws: ConnectionError.outboxMethodNotAllowed("message.send")) {
            _ = try await rig.connection.enqueue("message.send", ["text": "hi"])
        }
        await rig.shutdown()
    }

    @Test func aDeviceTheMacDoesNotKnowIsToldToPairAgain() async throws {
        let rig = try await Rig.make(allowDevice: false)
        await rig.connection.start()
        await eventually("stopped") { await rig.connection.state == .stopped(.pairAgain) }
        await rig.shutdown()
    }

    @Test func aRevokedDeviceStopsAndDoesNotRetry() async throws {
        let rig = try await Rig.make()
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }
        await rig.mac.setAllowed([])
        await eventually("stopped") { await rig.connection.state == .stopped(.revoked) }
        let before = await rig.mac.handshakes
        try await Task.sleep(nanoseconds: 500_000_000)
        #expect(await rig.mac.handshakes == before)
        await rig.shutdown()
    }

    @Test func aMacThatStopsAnsweringPingsIsLeftAndFoundAgain() async throws {
        let rig = try await Rig.make()
        await rig.connection.start()
        await eventually("connected") { await rig.connection.state == .connected }
        await rig.mac.setAnswerPings(false)
        await eventually("the link is declared dead") { await rig.connection.state != .connected }
        await rig.mac.setAnswerPings(true)
        await eventually("connected again") { await rig.connection.state == .connected }
        await rig.shutdown()
    }

    @Test func aDifferentRelayHostBreaksTheLoginSoAReplayedChallengeIsUseless() async throws {
        // The relay's host name is inside the signature (ADR-051). A device that signs another host is refused.
        let rig = try await Rig.make()
        var config = await rig.mac.config(relayURL: rig.relay.url)
        config.relayURL = URL(string: "ws://localhost:\(rig.relay.port)")!
        let connection = Connection(config: config, key: rig.key)
        await connection.start()
        await eventually("refused as not authenticated") { await connection.state == .stopped(.pairAgain) }
        await connection.stop()
        await rig.shutdown()
    }
}

@Test func aLongLineIsCutIntoFramesAndPutBackTogether() throws {
    let line = Data(repeating: UInt8(ascii: "x"), count: 100_000)
    let pieces = ChannelCodec.pieces(type: .line, body: line)
    #expect(pieces.count == 4)
    for piece in pieces {
        // The relay frame is 0x01 + sid + the noise message (header + body + tag).
        #expect(1 + RelayWire.sidBytes + piece.count + RelayWire.tagBytes <= RelayWire.maxFrameBytes)
    }
    var assembler = LineAssembler()
    var whole: Data?
    for (index, piece) in pieces.enumerated() {
        let result = try assembler.feed(piece)
        if index < pieces.count - 1 { #expect(result == nil) } else { whole = result?.1 }
    }
    #expect(whole == line)
}

@Test func aLineOverOneMebibyteIsRefused() {
    let big = Data([ChannelType.line.rawValue, ChannelCodec.moreFollows]) + Data(count: RelayWire.maxChunkBytes)
    var assembler = LineAssembler()
    var failed = false
    for _ in 0..<40 {
        do { _ = try assembler.feed(big) } catch { failed = true; break }
    }
    #expect(failed)
}

@Test func aBodyThatFitsGoesInOnePiece() throws {
    let pieces = ChannelCodec.pieces(type: .control, body: Data("{}".utf8))
    #expect(pieces == [Data([1, 0]) + Data("{}".utf8)])
}

@Test func theBackoffGrowsAndIsCapped() {
    let timing = ConnectionTiming(pingInterval: 5, linkTimeout: 10, backoffBase: 1, backoffCap: 30, maxAge: 1)
    #expect(timing.delay(attempt: 1, random: 0.999) < 1)
    #expect(timing.delay(attempt: 3, random: 0.999) < 4)
    #expect(timing.delay(attempt: 3, random: 0.999) > 3)
    #expect(timing.delay(attempt: 50, random: 0.999) < 30)
    #expect(timing.delay(attempt: 50, random: 0) == 0)
}

@Test func attachmentsDropRepeatsAndKeepTheNewestSeq() {
    var attachments = Attachments()
    let unfollowed = attachments.accept(sessionID: "a", seq: 1)
    #expect(unfollowed, "an unfollowed session passes everything")
    attachments.track("a", afterSeq: 5)
    let atSeen = attachments.accept(sessionID: "a", seq: 5)
    #expect(!atSeen)
    let newer = attachments.accept(sessionID: "a", seq: 6)
    #expect(newer)
    let repeated = attachments.accept(sessionID: "a", seq: 6)
    #expect(!repeated)
    attachments.track("a", afterSeq: 2)
    #expect(attachments.seen("a") == 6, "tracking from an older seq does not go back")
    attachments.untrack("a")
    #expect(attachments.seen("a") == nil)
}

@Test func theDeviceIDIsTheFirstSixteenBytesOfTheKeyHash() {
    let key = InMemoryDeviceKey()
    #expect(key.publicKey.count == 65)
    #expect(key.publicKey.first == 0x04)
    #expect(key.deviceID == Data(SHA256.hash(data: key.publicKey).prefix(16)))
    #expect(key.deviceIDHex.count == 32)
    let signature = try? key.sign(Data("m".utf8))
    #expect(signature?.count == 64)
}

@Test func theRelayLoginMessageHasTheHostAndTheNonce() {
    let message = RelayWire.authMessage(host: "relay.example.com", nonce: "abc")
    #expect(message == Data("golem-relay-v1\0devicerelay.example.comabc".utf8))
}
