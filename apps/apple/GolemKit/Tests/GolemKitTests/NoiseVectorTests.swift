import CryptoKit
import Foundation
import Testing
@testable import GolemKit

/// The repository root, found from this file's path.
let repoRoot: URL = {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 { url.deleteLastPathComponent() }
    return url
}()

private struct VectorFile: Decodable {
    struct Message: Decodable {
        let payload: String
        let ciphertext: String
    }

    struct Vector: Decodable {
        let protocolName: String
        let initPrologue: String
        let initEphemeral: String
        let initRemoteStatic: String
        let respPrologue: String
        let respStatic: String
        let respEphemeral: String
        let handshakeHash: String
        let messages: [Message]

        enum CodingKeys: String, CodingKey {
            case protocolName = "protocol_name"
            case initPrologue = "init_prologue"
            case initEphemeral = "init_ephemeral"
            case initRemoteStatic = "init_remote_static"
            case respPrologue = "resp_prologue"
            case respStatic = "resp_static"
            case respEphemeral = "resp_ephemeral"
            case handshakeHash = "handshake_hash"
            case messages
        }
    }

    let vectors: [Vector]
}

private func hex(_ text: String) -> Data {
    var data = Data()
    var index = text.startIndex
    while index < text.endIndex {
        let next = text.index(index, offsetBy: 2)
        data.append(UInt8(text[index..<next], radix: 16)!)
        index = next
    }
    return data
}

private func loadVectors() throws -> [VectorFile.Vector] {
    let url = repoRoot.appendingPathComponent("packages/protocol/vectors/noise/noise-nk-25519-aesgcm-sha256.json")
    return try JSONDecoder().decode(VectorFile.self, from: Data(contentsOf: url)).vectors
}

@Test func theVectorFileHasEntries() throws {
    let vectors = try loadVectors()
    #expect(!vectors.isEmpty)
    for vector in vectors { #expect(vector.protocolName == "Noise_NK_25519_AESGCM_SHA256") }
}

/// Every published vector: the initiator and the responder each reproduce every message
/// byte for byte, agree on the handshake hash, and open what the other side sealed.
@Test func everyNoiseVectorMatchesOnBothSides() throws {
    for (index, vector) in try loadVectors().enumerated() {
        let label = "vector \(index)"
        var initiator = NoiseInitiator(
            prologue: hex(vector.initPrologue),
            remoteStatic: hex(vector.initRemoteStatic),
            ephemeral: try .init(rawRepresentation: hex(vector.initEphemeral)))
        var responder = NoiseResponder(
            prologue: hex(vector.respPrologue),
            staticKey: try .init(rawRepresentation: hex(vector.respStatic)),
            ephemeral: try .init(rawRepresentation: hex(vector.respEphemeral)))

        let first = vector.messages[0]
        let message1 = try initiator.writeMessage1(payload: hex(first.payload))
        #expect(message1 == hex(first.ciphertext), "\(label): message 1")
        #expect(try responder.readMessage1(message1) == hex(first.payload), "\(label): message 1 payload")

        let second = vector.messages[1]
        let (message2, responderSide) = try responder.writeMessage2(payload: hex(second.payload))
        #expect(message2 == hex(second.ciphertext), "\(label): message 2")
        let (payload2, initiatorSide) = try initiator.readMessage2(message2)
        #expect(payload2 == hex(second.payload), "\(label): message 2 payload")

        #expect(initiatorSide.handshakeHash == hex(vector.handshakeHash), "\(label): initiator hash")
        #expect(responderSide.handshakeHash == hex(vector.handshakeHash), "\(label): responder hash")

        var phone = initiatorSide
        var mac = responderSide
        for (offset, message) in vector.messages.dropFirst(2).enumerated() {
            let fromInitiator = offset % 2 == 0
            let plaintext = hex(message.payload)
            if fromInitiator {
                let sealed = try phone.encrypt(plaintext)
                #expect(sealed == hex(message.ciphertext), "\(label): transport \(offset)")
                let opened = try mac.decrypt(sealed)
                #expect(opened == plaintext, "\(label): transport \(offset) opened")
            } else {
                let sealed = try mac.encrypt(plaintext)
                #expect(sealed == hex(message.ciphertext), "\(label): transport \(offset)")
                let opened = try phone.decrypt(sealed)
                #expect(opened == plaintext, "\(label): transport \(offset) opened")
            }
        }
    }
}

@Test func aTamperedHandshakeMessageIsRefused() throws {
    let vector = try loadVectors()[0]
    var responder = NoiseResponder(
        prologue: hex(vector.respPrologue),
        staticKey: try .init(rawRepresentation: hex(vector.respStatic)),
        ephemeral: try .init(rawRepresentation: hex(vector.respEphemeral)))
    var tampered = hex(vector.messages[0].ciphertext)
    tampered[tampered.count - 1] ^= 1
    #expect(throws: NoiseError.decryptionFailed) { try responder.readMessage1(tampered) }
}

@Test func theWrongPrologueFailsTheHandshake() throws {
    let vector = try loadVectors()[0]
    var initiator = NoiseInitiator(
        prologue: Data("golem-noise-v1".utf8),
        remoteStatic: hex(vector.initRemoteStatic),
        ephemeral: try .init(rawRepresentation: hex(vector.initEphemeral)))
    var responder = NoiseResponder(
        prologue: hex(vector.respPrologue),
        staticKey: try .init(rawRepresentation: hex(vector.respStatic)))
    let message = try initiator.writeMessage1()
    #expect(throws: NoiseError.decryptionFailed) { try responder.readMessage1(message) }
}

@Test func anAllZeroSharedSecretAbortsTheHandshake() throws {
    // The all-zero public key is a low-order point: the Diffie-Hellman result is all zero.
    var initiator = NoiseInitiator(prologue: Data(), remoteStatic: Data(count: 32))
    #expect(throws: NoiseError.self) { try initiator.writeMessage1() }

    var responder = NoiseResponder(prologue: Data(), staticKey: .init())
    let message = Data(count: 32) + Data(count: 16)
    #expect(throws: NoiseError.self) { try responder.readMessage1(message) }
}

@Test func aReplayedOrReorderedTransportMessageIsRefused() throws {
    let vector = try loadVectors()[0]
    var initiator = NoiseInitiator(
        prologue: hex(vector.initPrologue), remoteStatic: hex(vector.initRemoteStatic))
    var responder = NoiseResponder(
        prologue: hex(vector.respPrologue), staticKey: try .init(rawRepresentation: hex(vector.respStatic)))
    _ = try responder.readMessage1(try initiator.writeMessage1())
    let (message2, responderSide) = try responder.writeMessage2()
    let (_, initiatorSide) = try initiator.readMessage2(message2)
    var phone = initiatorSide
    var mac = responderSide
    let first = try phone.encrypt(Data("one".utf8))
    let second = try phone.encrypt(Data("two".utf8))
    #expect(throws: NoiseError.decryptionFailed) { try mac.decrypt(second) }
    let one = try mac.decrypt(first)
    #expect(one == Data("one".utf8))
    #expect(throws: NoiseError.decryptionFailed) { try mac.decrypt(first) }
    let two = try mac.decrypt(second)
    #expect(two == Data("two".utf8))
}

@Test func base64urlRoundTripsWithoutPadding() {
    for length in 0..<40 {
        let data = Data((0..<length).map { UInt8(truncatingIfNeeded: $0 * 37 + 11) })
        let text = Base64URL.encode(data)
        #expect(!text.contains("="))
        #expect(Base64URL.decode(text) == data)
    }
    #expect(Base64URL.decode("a+b") == nil)
    #expect(Base64URL.decode("a") == nil)
}
