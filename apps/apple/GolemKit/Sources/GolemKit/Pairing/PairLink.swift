import CryptoKit
import Foundation

/// What the pairing QR code says (ADR-051): where the relay is, which Mac to pin, and the one-time code.
///
/// `golem://pair?v=1&relay=wss://…&mac=<base64url>&code=<base64url>&exp=<unix seconds>&name=<Mac name>`
///
/// The code is a secret until it is used. This type never prints it: `description` leaves it out.
public struct PairLink: Equatable, Sendable, CustomStringConvertible {
    public enum Failure: Error, Equatable {
        /// Not a `golem://pair` link at all.
        case notAPairLink
        /// A pairing version this app does not know.
        case unsupportedVersion
        /// The relay address is missing, or is `ws://` outside the loopback.
        case badRelay
        /// A field is missing or does not decode.
        case malformed
        /// The `exp` time has passed.
        case expired
    }

    public static let version = 1
    /// The Mac's name is untrusted text for the screen: it is cut to this many characters.
    public static let maxNameLength = 64

    public let relayURL: URL
    /// The Mac's signing key, 65 bytes uncompressed (the link carries it compressed).
    public let macSigningKey: Data
    /// The Mac's Noise key, 32 bytes.
    public let macNoiseKey: Data
    /// The one-time code, 16 bytes.
    let code: Data
    public let expires: Date
    public let macName: String

    public init(
        relayURL: URL, macSigningKey: Data, macNoiseKey: Data, code: Data, expires: Date, macName: String
    ) {
        self.relayURL = relayURL
        self.macSigningKey = macSigningKey
        self.macNoiseKey = macNoiseKey
        self.code = code
        self.expires = expires
        self.macName = macName
    }

    /// The relay's name for this pairing's slot: base64url of SHA-256 of the code.
    var slot: String { Base64URL.encode(Data(SHA256.hash(data: code))) }

    public var description: String { "PairLink(\(macName))" }

    /// Reads a link. `now` is the clock, so a test can pick the time.
    public init(parsing text: String, now: Date = Date()) throws {
        guard let components = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "golem", components.host?.lowercased() == "pair"
        else { throw Failure.notAPairLink }
        var fields: [String: String] = [:]
        for item in components.queryItems ?? [] {
            guard let value = item.value, fields[item.name] == nil else { continue }
            fields[item.name] = value
        }
        guard fields["v"] == String(Self.version) else { throw Failure.unsupportedVersion }

        guard let relayText = fields["relay"], let relay = URL(string: relayText), let host = relay.host, !host.isEmpty
        else { throw Failure.badRelay }
        switch relay.scheme?.lowercased() {
        case "wss": break
        case "ws" where Self.isLoopback(host): break
        default: throw Failure.badRelay
        }

        guard let macText = fields["mac"], let mac = Base64URL.decode(macText), mac.count == 33 + 32,
              let signing = try? P256.Signing.PublicKey(compressedRepresentation: mac.prefix(33)),
              let codeText = fields["code"], let code = Base64URL.decode(codeText), code.count == 16,
              let expText = fields["exp"], let exp = TimeInterval(expText)
        else { throw Failure.malformed }
        let expires = Date(timeIntervalSince1970: exp)
        guard expires > now else { throw Failure.expired }

        self.init(
            relayURL: relay,
            macSigningKey: signing.x963Representation,
            macNoiseKey: Data(mac.suffix(32)),
            code: code,
            expires: expires,
            macName: Self.clean(fields["name"] ?? ""))
    }

    private static func isLoopback(_ host: String) -> Bool {
        ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
    }

    /// Plain text of at most `maxNameLength` characters: no control characters.
    static func clean(_ name: String) -> String {
        let kept = name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        return String(String.UnicodeScalarView(kept)).prefix(maxNameLength).trimmingCharacters(in: .whitespaces)
    }
}
