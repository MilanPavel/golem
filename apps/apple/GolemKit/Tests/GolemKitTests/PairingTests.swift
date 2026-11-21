import CryptoKit
import Foundation
import Testing
@testable import GolemKit

// MARK: - Making links

private let signing = P256.Signing.PrivateKey()
private let noise = Curve25519.KeyAgreement.PrivateKey()
private let sampleCode = Data((0..<16).map { UInt8($0 * 3) })

private func link(
    scheme: String = "golem", host: String = "pair", version: String = "1",
    relay: String = "wss://relay.example.com", exp: Int = 2_000_000_000, name: String = "Studio Mac",
    mac: Data? = nil, code: Data? = nil
) -> String {
    let macBytes = mac ?? (signing.publicKey.compressedRepresentation + noise.publicKey.rawRepresentation)
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.queryItems = [
        URLQueryItem(name: "v", value: version),
        URLQueryItem(name: "relay", value: relay),
        URLQueryItem(name: "mac", value: Base64URL.encode(macBytes)),
        URLQueryItem(name: "code", value: Base64URL.encode(code ?? sampleCode)),
        URLQueryItem(name: "exp", value: String(exp)),
        URLQueryItem(name: "name", value: name),
    ]
    return components.string!
}

private let now = Date(timeIntervalSince1970: 1_900_000_000)

// MARK: - Parsing

@Test func aGoodLinkParses() throws {
    let parsed = try PairLink(parsing: link(), now: now)
    #expect(parsed.relayURL.absoluteString == "wss://relay.example.com")
    #expect(parsed.macSigningKey == signing.publicKey.x963Representation)
    #expect(parsed.macSigningKey.count == 65)
    #expect(parsed.macNoiseKey == noise.publicKey.rawRepresentation)
    #expect(parsed.macName == "Studio Mac")
    #expect(parsed.expires == Date(timeIntervalSince1970: 2_000_000_000))
    #expect(parsed.slot == Base64URL.encode(Data(SHA256.hash(data: sampleCode))))
}

@Test func anExpiredLinkIsRefused() {
    #expect(throws: PairLink.Failure.expired) { try PairLink(parsing: link(exp: 1_800_000_000), now: now) }
}

@Test func aWrongSchemeIsRefused() {
    #expect(throws: PairLink.Failure.notAPairLink) { try PairLink(parsing: link(scheme: "https"), now: now) }
    #expect(throws: PairLink.Failure.notAPairLink) { try PairLink(parsing: link(host: "open"), now: now) }
    #expect(throws: PairLink.Failure.notAPairLink) { try PairLink(parsing: "not a link", now: now) }
}

@Test func anUnknownVersionIsRefused() {
    #expect(throws: PairLink.Failure.unsupportedVersion) { try PairLink(parsing: link(version: "2"), now: now) }
    #expect(throws: PairLink.Failure.unsupportedVersion) { try PairLink(parsing: link(version: ""), now: now) }
}

@Test func theRelayMustBeSecureExceptOnTheLoopback() throws {
    #expect(throws: PairLink.Failure.badRelay) { try PairLink(parsing: link(relay: "ws://relay.example.com"), now: now) }
    #expect(throws: PairLink.Failure.badRelay) { try PairLink(parsing: link(relay: "https://relay.example.com"), now: now) }
    #expect(throws: PairLink.Failure.badRelay) { try PairLink(parsing: link(relay: ""), now: now) }
    let local = try PairLink(parsing: link(relay: "ws://127.0.0.1:8080"), now: now)
    #expect(local.relayURL.port == 8080)
    _ = try PairLink(parsing: link(relay: "ws://localhost:8080"), now: now)
}

@Test func aDamagedLinkIsMalformed() {
    #expect(throws: PairLink.Failure.malformed) { try PairLink(parsing: link(mac: Data(repeating: 1, count: 64)), now: now) }
    #expect(throws: PairLink.Failure.malformed) { try PairLink(parsing: link(mac: Data(repeating: 9, count: 65)), now: now) }
    #expect(throws: PairLink.Failure.malformed) { try PairLink(parsing: link(code: Data(repeating: 1, count: 15)), now: now) }
    #expect(throws: PairLink.Failure.malformed) { try PairLink(parsing: link(exp: 0).replacingOccurrences(of: "exp=0", with: "exp=soon"), now: now) }
}

@Test func theMacNameIsPlainAndShort() throws {
    let long = String(repeating: "a", count: 200)
    #expect(try PairLink(parsing: link(name: long), now: now).macName.count == 64)
    #expect(try PairLink(parsing: link(name: "Mac\u{7}\u{1b}[31m"), now: now).macName == "Mac[31m")
    #expect(try PairLink(parsing: link(name: ""), now: now).macName == "")
}

@Test func theCodeIsNotInTheDescription() throws {
    let parsed = try PairLink(parsing: link(), now: now)
    #expect(!"\(parsed)".contains(Base64URL.encode(sampleCode)))
    #expect(!String(reflecting: parsed.description).contains(Base64URL.encode(sampleCode)))
}

// MARK: - The words

/// Expected values come from the TypeScript side (`packages/gateway/src/pair-words.test.ts`), which
/// took them from python's `cryptography` HKDF. Both ends must give the same words for the same `h`.
@Test func theWordsMatchTheGateway() {
    #expect(PairWords.words(handshakeHash: Data((0..<32).map { UInt8($0) })) == ["horror", "quiz", "identify"])
    #expect(PairWords.words(handshakeHash: Data(repeating: 0xab, count: 32)) == ["taxi", "rescue", "half"])
}

@Test func theWordListIsTheBip39List() throws {
    let file = repoRoot.appendingPathComponent("packages/protocol/vectors/bip39/english.txt")
    let text = try String(contentsOf: file, encoding: .utf8)
    #expect(SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        == "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda")
    #expect(Bip39English.words == text.split(separator: "\n").map(String.init))
    #expect(Bip39English.words.count == 2048)
}

// MARK: - The store

@Test func theStoreKeepsTheMac() throws {
    let store = InMemoryMacStore()
    #expect(try store.load() == nil)
    let mac = PairedMac(link: try PairLink(parsing: link(), now: now))
    try store.save(mac)
    #expect(try store.load() == mac)
    #expect(mac.connectionConfig().roomID == Data(SHA256.hash(data: signing.publicKey.x963Representation)))
    try store.forget()
    #expect(try store.load() == nil)
}

// MARK: - Pairing through a real relay

private func collect(_ stream: AsyncThrowingStream<PairingStep, Error>) async -> (steps: [PairingStep], failure: PairingFailure?) {
    var steps: [PairingStep] = []
    do {
        for try await step in stream { steps.append(step) }
        return (steps, nil)
    } catch {
        return (steps, error as? PairingFailure)
    }
}

private func pairLink(relay: RelayProcess, mac: ScriptedMac, code: Data) async throws -> PairLink {
    let text = link(
        relay: relay.url.absoluteString, mac: mac.signingKey.publicKey.compressedRepresentation
            + mac.noiseKey.publicKey.rawRepresentation, code: code)
    return try PairLink(parsing: text)
}

@Test(.enabled(if: RelayProcess.bunPath != nil)) func pairingThroughTheRelayKeepsTheMac() async throws {
    let relay = try RelayProcess()
    defer { relay.stop() }
    try await relay.waitUntilHealthy()
    let mac = ScriptedMac()
    try await mac.start(relayURL: relay.url)
    let code = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
    await mac.openPair(code: code)
    defer { Task { await mac.stop() } }

    let store = InMemoryMacStore()
    let service = RelayPairing(key: InMemoryDeviceKey(), deviceName: "Test iPhone", deviceModel: "iPhone", store: store)
    let result = await collect(service.pair(with: try await pairLink(relay: relay, mac: mac, code: code)))

    #expect(result.failure == nil)
    guard result.steps.count == 3, case .words(let words) = result.steps[1] else {
        Issue.record("unexpected steps \(result.steps)")
        return
    }
    #expect(result.steps[0] == .connecting)
    #expect(words.count == 3)
    #expect(words == (await mac.pairWordsShown))
    #expect(result.steps[2] == .paired(macName: "Studio Mac"))
    #expect(await mac.pairedName == "Test iPhone")
    let saved = try #require(try store.load())
    #expect(saved.macSigningKey == mac.signingKey.publicKey.x963Representation)
    #expect(saved.relayURL == relay.url)
}

@Test(.enabled(if: RelayProcess.bunPath != nil)) func aCodeTheRelayDoesNotKnowIsExpired() async throws {
    let relay = try RelayProcess()
    defer { relay.stop() }
    try await relay.waitUntilHealthy()
    let mac = ScriptedMac()
    try await mac.start(relayURL: relay.url)
    await mac.openPair(code: Data(repeating: 7, count: 16))
    defer { Task { await mac.stop() } }

    let store = InMemoryMacStore()
    let service = RelayPairing(key: InMemoryDeviceKey(), deviceName: "Test iPhone", deviceModel: "iPhone", store: store)
    let result = await collect(service.pair(with: try await pairLink(relay: relay, mac: mac, code: Data(repeating: 8, count: 16))))
    #expect(result.failure == .expired)
    #expect(try store.load() == nil)
}

@Test(.enabled(if: RelayProcess.bunPath != nil)) func anOwnerWhoRefusesStopsThePairing() async throws {
    let relay = try RelayProcess()
    defer { relay.stop() }
    try await relay.waitUntilHealthy()
    let mac = ScriptedMac()
    try await mac.start(relayURL: relay.url)
    let code = Data(repeating: 5, count: 16)
    await mac.openPair(code: code, answer: "pair_refused")
    defer { Task { await mac.stop() } }

    let store = InMemoryMacStore()
    let service = RelayPairing(key: InMemoryDeviceKey(), deviceName: "Test iPhone", deviceModel: "iPhone", store: store)
    let result = await collect(service.pair(with: try await pairLink(relay: relay, mac: mac, code: code)))
    #expect(result.failure == .refused)
    #expect(try store.load() == nil)
}
