import CryptoKit
import Foundation
@testable import GolemKit

/// Plays the Mac for a test: the relay login with a P-256 key, the allow list, the Noise
/// responder, and a few JSON-RPC answers (`hello`, `ping`, `session.list`, `session.attach` with
/// a replay from `seq`, `approval.respond`). It is what the gateway and the daemon do together.
actor ScriptedMac {
    private final class Channel {
        var responder: NoiseResponder?
        var transport: NoiseTransport?
        var assembler = LineAssembler()
        var open = false
        var attached: Set<String> = []
        let deviceID: Data
        let sid: Data

        init(deviceID: Data, sid: Data) {
            self.deviceID = deviceID
            self.sid = sid
        }
    }

    let signingKey = P256.Signing.PrivateKey()
    let noiseKey = Curve25519.KeyAgreement.PrivateKey()

    /// The device keys on the allow list.
    private var allowed: [Data] = []
    private var allowSeq = 0
    private var socket: RelaySocket?
    private var reader: Task<Void, Never>?
    private var channels: [Data: Channel] = [:]
    private var relayURL: URL?

    /// `session id -> events`, each with its `seq` (1, 2, 3...).
    private(set) var log: [String: [[String: Any]]] = [:]
    /// How many `seq` before `after_seq` a replay starts, to prove the app drops repeats.
    var replayOverlap = 0
    var answerPings = true
    private(set) var approvals: [[String: Any]] = []
    private(set) var attachCalls: [(session: String, afterSeq: Int)] = []
    private(set) var handshakes = 0

    var sessionList: [[String: Any]] = []

    /// Open pair slots (base64url SHA-256 of a code) and what the owner does when one is used.
    private var pairSlots: [String] = []
    private var pairAnswer = "paired"
    /// The words the Mac showed for the last pairing, and the name the phone gave.
    private(set) var pairWordsShown: [String] = []
    private(set) var pairedName: String?

    func openPair(code: Data, answer: String = "paired") {
        pairSlots = [Base64URL.encode(Data(SHA256.hash(data: code)))]
        pairAnswer = answer
        sendAllow()
    }

    func config(relayURL: URL) -> ConnectionConfig {
        ConnectionConfig(
            relayURL: relayURL,
            macSigningKey: signingKey.publicKey.x963Representation,
            macNoiseKey: noiseKey.publicKey.rawRepresentation,
            timing: ConnectionTiming(pingInterval: 0.2, linkTimeout: 1, backoffBase: 0.05, backoffCap: 0.2, maxAge: 3600))
    }

    func setAllowed(_ keys: [Data]) {
        allowed = keys
        sendAllow()
    }

    func setReplayOverlap(_ value: Int) { replayOverlap = value }
    func setAnswerPings(_ value: Bool) { answerPings = value }
    func setSessionList(_ value: [[String: Any]]) { sessionList = value }

    /// Connects to the relay as the Mac and sends the allow list.
    func start(relayURL: URL) async throws {
        self.relayURL = relayURL
        let socket = RelaySocket(url: relayURL.appendingPathComponent("v1/mac"))
        self.socket = socket
        channels = [:]
        guard case .text(let text) = try await socket.receive(),
              let challenge = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let nonce = challenge["nonce"] as? String
        else { throw ScriptedMacError.noChallenge }
        let message = Data("golem-relay-v1\0mac\(relayURL.host ?? "")\(nonce)".utf8)
        let signature = try signingKey.signature(for: message).rawRepresentation
        send(json: [
            "type": "auth", "v": 1,
            "key": Base64URL.encode(signingKey.publicKey.x963Representation),
            "sig": Base64URL.encode(signature),
        ])
        sendAllow()
        reader = Task { await self.readLoop(socket) }
    }

    /// Goes away: the relay tells the devices the Mac is offline, and the Noise sessions are gone.
    func stop() {
        reader?.cancel()
        reader = nil
        socket?.close()
        socket = nil
        channels = [:]
    }

    private func sendAllow() {
        allowSeq += 1
        send(json: [
            "type": "allow", "seq": allowSeq,
            "devices": allowed.map { ["key": Base64URL.encode($0)] },
            "pairs": pairSlots.map { ["slot": $0, "exp": Int(Date().timeIntervalSince1970) + 300] },
        ])
    }

    private func send(json object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        socket?.send(text: String(decoding: data, as: UTF8.self))
    }

    private func readLoop(_ socket: RelaySocket) async {
        while !Task.isCancelled {
            guard let incoming = try? await socket.receive() else { return }
            if case .binary(let data) = incoming { handle(frame: data) }
        }
    }

    // MARK: - Frames: 0x01 || device id (16) || sid (4) || noise message

    private func handle(frame: Data) {
        guard frame.count > 21, frame[frame.startIndex] == 0x01 else { return }
        let start = frame.startIndex
        let deviceID = Data(frame[(start + 1)..<(start + 17)])
        let sid = Data(frame[(start + 17)..<(start + 21)])
        let noise = Data(frame[(start + 21)...])
        let key = deviceID + sid
        do {
            if channels[key] == nil {
                let channel = Channel(deviceID: deviceID, sid: sid)
                var responder = NoiseResponder(
                    prologue: RelayWire.prologue(roomID: Data(SHA256.hash(data: signingKey.publicKey.x963Representation))),
                    staticKey: noiseKey)
                _ = try responder.readMessage1(noise)
                let (message2, transport) = try responder.writeMessage2()
                channel.transport = transport
                channels[key] = channel
                handshakes += 1
                reply(frameFor: channel, noise: message2)
                return
            }
            guard let channel = channels[key], channel.transport != nil,
                  let plain = try channel.transport?.decrypt(noise),
                  let (type, body) = try channel.assembler.feed(plain)
            else { return }
            switch type {
            case .control: try handleControl(body, channel: channel)
            case .line: handleLine(body, channel: channel)
            }
        } catch {
            channels[key] = nil
        }
    }

    private func reply(frameFor channel: Channel, noise: Data) {
        socket?.send(data: Data([0x01]) + channel.deviceID + channel.sid + noise)
    }

    private func sendChannel(_ type: ChannelType, _ body: Data, to channel: Channel) {
        for piece in ChannelCodec.pieces(type: type, body: body) {
            guard let sealed = try? channel.transport?.encrypt(piece) else { return }
            reply(frameFor: channel, noise: sealed)
        }
    }

    private func sendLine(_ object: [String: Any], to channel: Channel) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        sendChannel(.line, data, to: channel)
    }

    /// The device proves its key: it must be on the allow list and have signed `"golem-auth-v1" || h`.
    private func handleControl(_ body: Data, channel: Channel) throws {
        if let message = try JSONSerialization.jsonObject(with: body) as? [String: Any], message["type"] as? String == "pair" {
            try handlePair(message, channel: channel)
            return
        }
        guard let message = try JSONSerialization.jsonObject(with: body) as? [String: Any],
              message["type"] as? String == "auth",
              let keyText = message["key"] as? String, let key = Base64URL.decode(keyText),
              let sigText = message["sig"] as? String, let sig = Base64URL.decode(sigText),
              let hash = channel.transport?.handshakeHash
        else { throw ScriptedMacError.badAuth }
        let publicKey = try P256.Signing.PublicKey(x963Representation: key)
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: sig)
        let signed = RelayWire.channelAuthMessage(handshakeHash: hash)
        guard allowed.contains(key), publicKey.isValidSignature(signature, for: signed),
              Data(SHA256.hash(data: key).prefix(16)) == channel.deviceID
        else {
            let error = try JSONSerialization.data(withJSONObject: ["type": "error", "code": "unknown_device", "message": "no"])
            sendChannel(.control, error, to: channel)
            throw ScriptedMacError.badAuth
        }
        channel.open = true
        let ok = try JSONSerialization.data(withJSONObject: ["type": "ok", "device": channel.deviceID.map { String(format: "%02x", $0) }.joined()])
        sendChannel(.control, ok, to: channel)
    }

    /// `pair`: check the signature over `"golem-pair-v1" || h` and the code, show the words, then answer as the owner would.
    private func handlePair(_ message: [String: Any], channel: Channel) throws {
        guard let keyText = message["key"] as? String, let key = Base64URL.decode(keyText),
              let sigText = message["sig"] as? String, let sig = Base64URL.decode(sigText),
              let codeText = message["code"] as? String, let code = Base64URL.decode(codeText),
              let hash = channel.transport?.handshakeHash
        else { throw ScriptedMacError.badAuth }
        let publicKey = try P256.Signing.PublicKey(x963Representation: key)
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: sig)
        guard publicKey.isValidSignature(signature, for: Data("golem-pair-v1".utf8) + hash),
              pairSlots.contains(Base64URL.encode(Data(SHA256.hash(data: code))))
        else { throw ScriptedMacError.badAuth }
        pairedName = message["name"] as? String
        pairWordsShown = PairWords.words(handshakeHash: hash)
        func control(_ object: [String: Any]) throws {
            sendChannel(.control, try JSONSerialization.data(withJSONObject: object), to: channel)
        }
        try control(["type": "pair.words", "words": pairWordsShown])
        if pairAnswer == "paired" {
            allowed.append(key)
            pairSlots = []
            sendAllow()
            try control(["type": "paired", "device": channel.deviceID.map { String(format: "%02x", $0) }.joined()])
        } else {
            try control(["type": "error", "code": pairAnswer, "message": "no"])
        }
    }

    private func handleLine(_ body: Data, channel: Channel) {
        guard channel.open, let request = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let id = request["id"], let method = request["method"] as? String
        else { return }
        let params = request["params"] as? [String: Any] ?? [:]
        func answer(_ result: Any) { sendLine(["jsonrpc": "2.0", "id": id, "result": result], to: channel) }
        switch method {
        case "hello":
            answer(["daemon_version": "scripted", "protocol_major": ProtocolVersion.major, "protocol_minor": ProtocolVersion.minor])
        case "ping":
            if answerPings { answer([String: Any]()) }
        case "session.list":
            answer(["sessions": sessionList])
        case "session.attach":
            let sessionID = params["session_id"] as? String ?? ""
            let after = params["after_seq"] as? Int ?? 0
            attachCalls.append((sessionID, after))
            channel.attached.insert(sessionID)
            let events = log[sessionID] ?? []
            let from = max(0, after - replayOverlap)
            for event in events where (event["seq"] as? Int ?? 0) > from {
                sendLine(["jsonrpc": "2.0", "method": "event", "params": event], to: channel)
            }
            answer(["session_id": sessionID, "last_seq": events.count])
        case "approval.respond":
            approvals.append(params)
            answer(["run_id": "r1"])
        default:
            sendLine(["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "unknown method"]], to: channel)
        }
    }

    // MARK: - Making events

    /// Appends the next event of `session` and pushes it to every channel that attached it.
    @discardableResult
    func emit(session: String) -> Int {
        let seq = (log[session]?.count ?? 0) + 1
        let event: [String: Any] = [
            "type": "test.tick", "seq": seq, "session_id": session, "run_id": NSNull(), "ts": "t", "data": [String: Any](),
        ]
        log[session, default: []].append(event)
        for channel in channels.values where channel.attached.contains(session) {
            sendLine(["jsonrpc": "2.0", "method": "event", "params": event], to: channel)
        }
        return seq
    }
}

enum ScriptedMacError: Error {
    case noChallenge, badAuth
}

/// One `session.list` row that decodes as `SessionElement`.
func sessionRow(_ id: String, title: String, lastSeq: Int = 0) -> [String: Any] {
    [
        "session_id": id, "title": title, "status": "idle", "last_seq": lastSeq,
        "created_at": "2026-11-21T10:00:00Z", "updated_at": "2026-11-21T10:00:00Z", "model_profile": "default",
    ]
}
