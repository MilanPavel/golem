import CryptoKit
import Foundation

/// How a pairing is going, as the screens show it.
public enum PairingStep: Equatable, Sendable {
    /// Reaching the relay and shaking hands with the Mac.
    case connecting
    /// The Mac has the code. Both screens show these words, and the owner confirms on the Mac.
    case words([String])
    /// The owner confirmed. The Mac is saved.
    case paired(macName: String)
}

/// Why a pairing did not finish.
public enum PairingFailure: Error, Equatable, Sendable {
    /// The code ran out, was used already, or the owner did not confirm in time. A new QR is needed.
    case expired
    /// The Mac does not know this code.
    case wrongCode
    /// The owner said no on the Mac.
    case refused
    /// The relay is up and the Mac is not.
    case macUnreachable
    /// The relay cannot be reached.
    case relayUnreachable
    /// Anything else: a message out of order, a key that cannot sign, a Mac that could not be saved.
    case failed
}

/// The phone's half of pairing. A screen holds one of these, so a test can put a fake in its place.
public protocol PairingService: Sendable {
    /// Pairs with the Mac in `link`. The stream ends after `.paired`, or throws a `PairingFailure`.
    func pair(with link: PairLink) -> AsyncThrowingStream<PairingStep, Error>
}

public struct PairingTiming: Sendable {
    /// How long reaching the relay and the Mac may take before the first words.
    public var connect: Double
    /// How long the owner has to confirm (ADR-051: 2 minutes, and a little slack).
    public var confirm: Double

    public init(connect: Double, confirm: Double) {
        self.connect = connect
        self.confirm = confirm
    }

    public static let standard = PairingTiming(connect: 15, confirm: 130)
}

/// Pairs through the relay (ADR-051, "Pairing"): connects as a device with the pair slot, shakes
/// hands with the Mac, sends `pair`, shows the words, and on `paired` keeps the Mac.
///
/// Nothing here logs. The one-time code and the device key never leave this type except in the
/// messages the protocol defines.
public struct RelayPairing: PairingService {
    private let key: any DeviceKey
    private let deviceName: String
    private let deviceModel: String
    private let store: any MacStore
    private let timing: PairingTiming

    /// - Parameters:
    ///   - deviceName: the phone's name for the Mac's prompt, such as `UIDevice.current.name`.
    ///   - deviceModel: the model, such as `iPhone`.
    public init(
        key: any DeviceKey, deviceName: String, deviceModel: String, store: any MacStore,
        timing: PairingTiming = .standard
    ) {
        self.key = key
        self.deviceName = PairLink.clean(deviceName)
        self.deviceModel = PairLink.clean(deviceModel)
        self.store = store
        self.timing = timing
    }

    public func pair(with link: PairLink) -> AsyncThrowingStream<PairingStep, Error> {
        let (stream, continuation) = AsyncThrowingStream<PairingStep, Error>.makeStream()
        let session = Session(
            link: link, key: key, deviceName: deviceName, deviceModel: deviceModel, store: store, timing: timing)
        let task = Task {
            do {
                try await session.run { continuation.yield($0) }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error is CancellationError ? PairingFailure.failed : error)
            }
        }
        continuation.onTermination = { _ in
            task.cancel()
            session.cancel()
        }
        return stream
    }

    /// One pairing on one relay socket.
    private final class Session: @unchecked Sendable {
        private let link: PairLink
        private let key: any DeviceKey
        private let deviceName: String
        private let deviceModel: String
        private let store: any MacStore
        private let timing: PairingTiming

        private let lock = NSLock()
        private var socket: RelaySocket?
        private var watchdog: Task<Void, Never>?
        private var timedOut = false

        init(link: PairLink, key: any DeviceKey, deviceName: String, deviceModel: String, store: any MacStore, timing: PairingTiming) {
            self.link = link
            self.key = key
            self.deviceName = deviceName
            self.deviceModel = deviceModel
            self.store = store
            self.timing = timing
        }

        func cancel() {
            lock.withLock {
                watchdog?.cancel()
                socket?.close()
            }
        }

        private func arm(seconds: Double) {
            lock.withLock {
                watchdog?.cancel()
                watchdog = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                    guard !Task.isCancelled, let self else { return }
                    self.lock.withLock {
                        self.timedOut = true
                        self.socket?.close()
                    }
                }
            }
        }

        private var didTimeOut: Bool { lock.withLock { timedOut } }

        func run(report: @Sendable (PairingStep) -> Void) async throws {
            report(.connecting)
            let socket = RelaySocket(url: link.relayURL.appendingPathComponent("v1/device"))
            lock.withLock { self.socket = socket }
            arm(seconds: timing.connect)
            defer {
                cancel()
            }

            var reachedRelay = false
            var initiator: NoiseInitiator?
            var transport: NoiseTransport?
            var sid = Data()
            var assembler = LineAssembler()
            var sawWords = false

            do {
                try await login(socket)
                while true {
                    switch try await socket.receive() {
                    case .text(let text):
                        guard let message = Self.object(text), message["type"] as? String == "peer" else { continue }
                        reachedRelay = true
                        if message["state"] as? String == "online", initiator == nil, transport == nil {
                            sid = Data((0..<RelayWire.sidBytes).map { _ in UInt8.random(in: 0...255) })
                            var made = NoiseInitiator(
                                prologue: RelayWire.prologue(roomID: roomID), remoteStatic: link.macNoiseKey)
                            socket.send(data: RelayWire.frame(sid: sid, noise: try made.writeMessage1()))
                            initiator = made
                        }
                    case .binary(let data):
                        guard let frame = RelayWire.parseFrame(data), frame.sid == sid else { continue }
                        if initiator != nil {
                            guard let (_, ready) = try initiator?.readMessage2(frame.noise) else { continue }
                            initiator = nil
                            transport = ready
                            try sendPair(on: socket, sid: sid, transport: &transport, handshakeHash: ready.handshakeHash)
                            continue
                        }
                        guard transport != nil, let plain = try transport?.decrypt(frame.noise),
                              let (type, body) = try assembler.feed(plain), type == .control,
                              let message = Self.object(String(decoding: body, as: UTF8.self)),
                              let kind = message["type"] as? String
                        else { continue }
                        switch kind {
                        case "pair.words":
                            guard !sawWords, let h = transport?.handshakeHash else { throw PairingFailure.failed }
                            sawWords = true
                            // The owner has the confirm window. The words are ours: the Mac's words must match.
                            let words = PairWords.words(handshakeHash: h)
                            if let theirs = message["words"] as? [String], theirs != words { throw PairingFailure.failed }
                            arm(seconds: timing.confirm)
                            report(.words(words))
                        case "paired":
                            guard sawWords else { throw PairingFailure.failed }
                            let mac = PairedMac(link: link)
                            do { try store.save(mac) } catch { throw PairingFailure.failed }
                            report(.paired(macName: mac.name))
                            return
                        case "error":
                            throw Self.failure(forCode: message["code"] as? String)
                        default:
                            continue
                        }
                    }
                }
            } catch let failure as PairingFailure {
                throw failure
            } catch let error as RelaySocketError {
                if didTimeOut {
                    if sawWords { throw PairingFailure.expired }
                    throw reachedRelay ? PairingFailure.macUnreachable : PairingFailure.relayUnreachable
                }
                if Task.isCancelled { throw CancellationError() }
                if case .closed(let code) = error, code == RelayClose.notAuthenticated { throw PairingFailure.expired }
                throw PairingFailure.relayUnreachable
            } catch {
                throw Task.isCancelled ? CancellationError() : PairingFailure.failed
            }
        }

        private var roomID: Data { Data(SHA256.hash(data: link.macSigningKey)) }

        /// Answers the relay's challenge with the device key and the pair slot.
        private func login(_ socket: RelaySocket) async throws {
            guard case .text(let text) = try await socket.receive(),
                  let challenge = Self.object(text), challenge["type"] as? String == "challenge",
                  challenge["v"] as? Int == RelayWire.protocolVersion,
                  let nonce = challenge["nonce"] as? String
            else { throw PairingFailure.relayUnreachable }
            let signature: Data
            do {
                signature = try key.sign(RelayWire.authMessage(host: link.relayURL.host ?? "", nonce: nonce))
            } catch { throw PairingFailure.failed }
            socket.send(text: Self.json([
                "type": "auth",
                "v": RelayWire.protocolVersion,
                "key": Base64URL.encode(key.publicKey),
                "sig": Base64URL.encode(signature),
                "mac": Base64URL.encode(roomID),
                "pair": link.slot,
            ]))
        }

        /// `pair`: the code, the device key, a name, and a signature over `"golem-pair-v1" || h`.
        private func sendPair(
            on socket: RelaySocket, sid: Data, transport: inout NoiseTransport?, handshakeHash: Data
        ) throws {
            let signature: Data
            do {
                signature = try key.sign(Data("golem-pair-v1".utf8) + handshakeHash)
            } catch { throw PairingFailure.failed }
            let body = Data(Self.json([
                "type": "pair",
                "v": RelayWire.protocolVersion,
                "code": Base64URL.encode(link.code),
                "key": Base64URL.encode(key.publicKey),
                "name": deviceName,
                "model": deviceModel,
                "sig": Base64URL.encode(signature),
            ]).utf8)
            for piece in ChannelCodec.pieces(type: .control, body: body) {
                guard let sealed = try transport?.encrypt(piece) else { throw PairingFailure.failed }
                socket.send(data: RelayWire.frame(sid: sid, noise: sealed))
            }
        }

        private static func failure(forCode code: String?) -> PairingFailure {
            switch code {
            case "pair_expired": return .expired
            case "pair_wrong_code": return .wrongCode
            case "pair_refused": return .refused
            case "daemon_unavailable": return .macUnreachable
            default: return .failed
            }
        }

        private static func object(_ text: String) -> [String: Any]? {
            try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        }

        private static func json(_ object: [String: Any]) -> String {
            let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
            return String(decoding: data, as: UTF8.self)
        }
    }
}
