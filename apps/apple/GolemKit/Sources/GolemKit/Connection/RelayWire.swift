import CryptoKit
import Foundation

/// The relay's close codes (ADR-051, "Close codes").
enum RelayClose {
    static let badMessage = 4400
    static let notAuthenticated = 4401
    static let revoked = 4403
    static let idle = 4408
    static let replaced = 4409
    static let tooBig = 4413
    static let rateLimited = 4429
    static let tryLater = 1013
}

enum RelayWire {
    static let protocolVersion = 1
    static let frameData: UInt8 = 0x01
    static let sidBytes = 4
    /// A relay data frame is at most 32 KiB.
    static let maxFrameBytes = 32 * 1024
    /// A protocol line is at most 1 MiB (ADR-028, `MAX_LINE_BYTES`).
    static let maxLineBytes = 1024 * 1024
    /// The channel header: type and flags.
    static let channelHeaderBytes = 2
    static let tagBytes = 16

    /// The most body bytes one Noise message carries, so that the relay frame
    /// (`0x01 || sid || noise message`) fits 32 KiB.
    static let maxChunkBytes = maxFrameBytes - 1 - sidBytes - channelHeaderBytes - tagBytes

    /// The message the device signs for the relay: `"golem-relay-v1\0" + role + host + nonce`, as UTF-8.
    static func authMessage(host: String, nonce: String) -> Data {
        Data("golem-relay-v1\0device\(host)\(nonce)".utf8)
    }

    /// The message the device signs inside the channel: `"golem-auth-v1" || h`.
    static func channelAuthMessage(handshakeHash: Data) -> Data {
        Data("golem-auth-v1".utf8) + handshakeHash
    }

    /// The Noise prologue: `"golem-noise-v1" || room id`, with the room id as the 32 raw bytes of
    /// SHA-256 of the Mac's signing key. ADR-051 writes the concatenation but not the encoding of the
    /// room id; the gateway (#754) must agree.
    static func prologue(roomID: Data) -> Data {
        Data("golem-noise-v1".utf8) + roomID
    }

    /// device to relay: `0x01 || sid || noise message`.
    static func frame(sid: Data, noise: Data) -> Data {
        Data([frameData]) + sid + noise
    }

    /// relay to device: `0x01 || sid || noise message`. Nil when the layout is wrong.
    static func parseFrame(_ data: Data) -> (sid: Data, noise: Data)? {
        guard data.count > 1 + sidBytes, data[data.startIndex] == frameData else { return nil }
        let start = data.startIndex
        return (Data(data[(start + 1)..<(start + 1 + sidBytes)]), Data(data[(start + 1 + sidBytes)...]))
    }
}

/// What travels inside a Noise message: `type (1 byte) || flags (1 byte) || body`.
enum ChannelType: UInt8 {
    /// One protocol line.
    case line = 0
    /// A control message for the gateway.
    case control = 1
}

enum ChannelCodec {
    /// Flag bit 0: more of this line follows.
    static let moreFollows: UInt8 = 0x01

    /// Cuts a body into pieces that each fit one relay frame. Only a line is ever cut.
    static func pieces(type: ChannelType, body: Data) -> [Data] {
        guard body.count > RelayWire.maxChunkBytes else { return [Data([type.rawValue, 0]) + body] }
        var out: [Data] = []
        var offset = body.startIndex
        while offset < body.endIndex {
            let end = min(offset + RelayWire.maxChunkBytes, body.endIndex)
            let more = end < body.endIndex ? moreFollows : 0
            out.append(Data([type.rawValue, more]) + body[offset..<end])
            offset = end
        }
        return out
    }
}

/// Puts the pieces of a line back together. A line over 1 MiB, or a stray type, ends the session.
struct LineAssembler {
    enum Failure: Error { case tooLong, malformed }

    private var partial = Data()
    private var partialType: ChannelType?

    /// Feeds one decrypted channel message. Returns a whole body and its type, or nil while more follows.
    mutating func feed(_ message: Data) throws -> (ChannelType, Data)? {
        guard message.count >= RelayWire.channelHeaderBytes,
              let type = ChannelType(rawValue: message[message.startIndex])
        else { throw Failure.malformed }
        let flags = message[message.startIndex + 1]
        let body = message.dropFirst(RelayWire.channelHeaderBytes)
        if let partialType, partialType != type { throw Failure.malformed }
        guard partial.count + body.count <= RelayWire.maxLineBytes else { throw Failure.tooLong }
        if flags & ChannelCodec.moreFollows != 0 {
            partial.append(contentsOf: body)
            partialType = type
            return nil
        }
        let whole = partial + body
        partial = Data()
        partialType = nil
        return (type, whole)
    }
}

/// The settings of one pairing: where the relay is and which Mac to reach. The pairing flow
/// (14.5.x) fills these from the QR code and keeps them.
public struct ConnectionConfig: Sendable {
    /// The relay, such as `wss://relay.example.com`. The connection appends `/v1/device`.
    public var relayURL: URL
    /// The Mac's signing key, 65 bytes uncompressed. Its SHA-256 is the room id.
    public var macSigningKey: Data
    /// The Mac's Noise static key, 32 bytes: the responder key of the handshake.
    public var macNoiseKey: Data
    /// The name sent in `hello`.
    public var clientName: String
    public var timing: ConnectionTiming

    public init(
        relayURL: URL,
        macSigningKey: Data,
        macNoiseKey: Data,
        clientName: String = "ios",
        timing: ConnectionTiming = .standard
    ) {
        self.relayURL = relayURL
        self.macSigningKey = macSigningKey
        self.macNoiseKey = macNoiseKey
        self.clientName = clientName
        self.timing = timing
    }

    /// SHA-256 of the Mac's signing key: the room id, 32 bytes.
    var roomID: Data { Data(SHA256.hash(data: macSigningKey)) }

    var endpoint: URL { relayURL.appendingPathComponent("v1/device") }

    /// The relay's host name as it goes into the signature (without a port).
    var relayHost: String { relayURL.host ?? "" }
}

/// Time limits and the backoff, in seconds. Tests shorten them.
public struct ConnectionTiming: Sendable {
    /// How often the end-to-end `ping` goes out (ADR-028: 5 s).
    public var pingInterval: Double
    /// How long a `ping`, the handshake, or `hello` may take before the link counts as dead (ADR-028: 10 s).
    public var linkTimeout: Double
    /// Reconnect delay: full jitter, the ceiling doubling from `backoffBase` to `backoffCap`.
    public var backoffBase: Double
    public var backoffCap: Double
    /// A connection lives at most 24 hours, then a new handshake (ADR-051).
    public var maxAge: Double

    public init(pingInterval: Double, linkTimeout: Double, backoffBase: Double, backoffCap: Double, maxAge: Double) {
        self.pingInterval = pingInterval
        self.linkTimeout = linkTimeout
        self.backoffBase = backoffBase
        self.backoffCap = backoffCap
        self.maxAge = maxAge
    }

    public static let standard = ConnectionTiming(
        pingInterval: 5, linkTimeout: 10, backoffBase: 1, backoffCap: 30, maxAge: 24 * 3600)

    /// The delay before reconnect attempt `attempt` (1 for the first retry).
    func delay(attempt: Int, random: Double = .random(in: 0..<1)) -> Double {
        let ceiling = min(backoffCap, backoffBase * pow(2, Double(max(0, attempt - 1))))
        return random * ceiling
    }
}

/// Where the connection stands.
public enum ConnectionState: Equatable, Sendable {
    /// Opening the relay, or shaking hands with the Mac.
    case connecting
    /// The channel to the Mac is up and `hello` is done.
    case connected
    /// The relay is up and the Mac is not.
    case macUnreachable
    /// The relay cannot be reached, or dropped us.
    case relayUnreachable
    /// The connection will not retry by itself. See `StopReason`.
    case stopped(StopReason)
}

public enum StopReason: Equatable, Sendable {
    /// `start()` has not been called, or `stop()` was.
    case stopped
    /// The relay or the Mac does not know this phone's key (4401, `unknown_device`). The app shows "pair again".
    case pairAgain
    /// The Mac revoked this phone (4403, `revoked`). The app forgets the Mac.
    case revoked
    /// Another instance of this phone's connection took the place (4409).
    case replaced
    /// The Mac refused the protocol version in `hello`.
    case incompatible(String)
}

public enum ConnectionError: Error, Equatable {
    /// There is no channel to the Mac right now.
    case notConnected
    /// The method is not in the `device` list the app may call.
    case methodNotAllowed(String)
    case timedOut
    /// The Mac answered with a JSON-RPC error.
    case rpc(code: Int, message: String)
    case outboxFull
    case outboxMethodNotAllowed(String)
    case invalidResponse
}
