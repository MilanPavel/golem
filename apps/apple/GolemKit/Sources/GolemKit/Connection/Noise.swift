import CryptoKit
import Foundation

// Noise_NK_25519_AESGCM_SHA256, written by hand on CryptoKit, following the Noise
// specification revision 34. No dependency (ADR-051, ADR-052). The published vectors
// in packages/protocol/vectors/noise are the gate; see NoiseVectorTests.
//
// Nothing in this file logs, prints, or describes a key.

enum NoiseError: Error, Equatable {
    case invalidPublicKey
    /// The Diffie-Hellman result was all zero (a low-order point). The spec says to abort.
    case zeroSharedSecret
    case decryptionFailed
    /// A cipher state that has used 2^64 - 1 nonces must not be used again.
    case nonceExhausted
    case malformedMessage
    case wrongState
}

private let protocolName = "Noise_NK_25519_AESGCM_SHA256"
private let hashLength = 32
private let tagLength = 16
private let dhLength = 32

/// A key and a counter. The nonce is 4 zero bytes and the counter, big-endian (spec section 12).
struct NoiseCipherState {
    private var key: SymmetricKey?
    private var counter: UInt64 = 0

    init(key: SymmetricKey? = nil) {
        self.key = key
    }

    private func nonce() throws -> AES.GCM.Nonce {
        var bytes = Data(count: 4)
        withUnsafeBytes(of: counter.bigEndian) { bytes.append(contentsOf: $0) }
        return try AES.GCM.Nonce(data: bytes)
    }

    /// Without a key the plaintext passes through, as in the spec. The counter moves
    /// only after a message is sealed, and never wraps.
    mutating func encrypt(ad: Data, plaintext: Data) throws -> Data {
        guard let key else { return plaintext }
        guard counter != UInt64.max else { throw NoiseError.nonceExhausted }
        let box = try AES.GCM.seal(plaintext, using: key, nonce: try nonce(), authenticating: ad)
        counter += 1
        return box.ciphertext + box.tag
    }

    /// A message that fails to open leaves the counter where it was, and the caller
    /// ends the session.
    mutating func decrypt(ad: Data, ciphertext: Data) throws -> Data {
        guard let key else { return ciphertext }
        guard counter != UInt64.max else { throw NoiseError.nonceExhausted }
        guard ciphertext.count >= tagLength else { throw NoiseError.malformedMessage }
        let split = ciphertext.count - tagLength
        let body = ciphertext.prefix(split)
        let tag = ciphertext.suffix(tagLength)
        do {
            let box = try AES.GCM.SealedBox(nonce: try nonce(), ciphertext: body, tag: tag)
            let plain = try AES.GCM.open(box, using: key, authenticating: ad)
            counter += 1
            return plain
        } catch {
            throw NoiseError.decryptionFailed
        }
    }
}

/// The chaining key, the handshake hash, and the cipher of the handshake.
struct NoiseSymmetricState {
    private(set) var chainingKey: Data
    private(set) var hash: Data
    private var cipher = NoiseCipherState()

    init() {
        let name = Data(protocolName.utf8)
        // The name is 28 bytes, shorter than HASHLEN, so it is padded with zeros.
        hash = name.count <= hashLength
            ? name + Data(count: hashLength - name.count)
            : Data(SHA256.hash(data: name))
        chainingKey = hash
    }

    mutating func mixHash(_ data: Data) {
        hash = Data(SHA256.hash(data: hash + data))
    }

    mutating func mixKey(_ inputKeyMaterial: Data) {
        let (next, key) = Self.hkdf(chainingKey: chainingKey, input: inputKeyMaterial)
        chainingKey = next
        cipher = NoiseCipherState(key: SymmetricKey(data: key))
    }

    mutating func encryptAndHash(_ plaintext: Data) throws -> Data {
        let ciphertext = try cipher.encrypt(ad: hash, plaintext: plaintext)
        mixHash(ciphertext)
        return ciphertext
    }

    mutating func decryptAndHash(_ ciphertext: Data) throws -> Data {
        let plaintext = try cipher.decrypt(ad: hash, ciphertext: ciphertext)
        mixHash(ciphertext)
        return plaintext
    }

    /// The two transport cipher states: the first encrypts what the initiator sends.
    func split() -> (NoiseCipherState, NoiseCipherState) {
        let (first, second) = Self.hkdf(chainingKey: chainingKey, input: Data())
        return (NoiseCipherState(key: SymmetricKey(data: first)), NoiseCipherState(key: SymmetricKey(data: second)))
    }

    /// HKDF with HMAC-SHA256 and two outputs (spec section 4.3).
    private static func hkdf(chainingKey: Data, input: Data) -> (Data, Data) {
        let temp = SymmetricKey(data: Data(HMAC<SHA256>.authenticationCode(for: input, using: SymmetricKey(data: chainingKey))))
        let first = Data(HMAC<SHA256>.authenticationCode(for: Data([0x01]), using: temp))
        let second = Data(HMAC<SHA256>.authenticationCode(for: first + Data([0x02]), using: temp))
        return (first, second)
    }
}

/// X25519, refusing an all-zero result.
private func diffieHellman(_ privateKey: Curve25519.KeyAgreement.PrivateKey, _ publicKey: Data) throws -> Data {
    guard publicKey.count == dhLength,
          let remote = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey),
          let secret = try? privateKey.sharedSecretFromKeyAgreement(with: remote)
    else { throw NoiseError.invalidPublicKey }
    let bytes = secret.withUnsafeBytes { Data($0) }
    // OR every byte together, so the check does not stop at the first non-zero one.
    let folded = bytes.reduce(UInt8(0)) { $0 | $1 }
    guard folded != 0 else { throw NoiseError.zeroSharedSecret }
    return bytes
}

/// The session after the handshake: one cipher for each direction, and the handshake hash.
struct NoiseTransport {
    private var sending: NoiseCipherState
    private var receiving: NoiseCipherState
    /// `h` at the end of the handshake. It binds the device's signature to this session.
    let handshakeHash: Data

    fileprivate init(sending: NoiseCipherState, receiving: NoiseCipherState, handshakeHash: Data) {
        self.sending = sending
        self.receiving = receiving
        self.handshakeHash = handshakeHash
    }

    mutating func encrypt(_ plaintext: Data) throws -> Data {
        try sending.encrypt(ad: Data(), plaintext: plaintext)
    }

    mutating func decrypt(_ ciphertext: Data) throws -> Data {
        try receiving.decrypt(ad: Data(), ciphertext: ciphertext)
    }
}

/// The initiator of NK: `<- s`, then `-> e, es` and `<- e, ee`. The phone is the initiator,
/// and knows the Mac's static key from the pairing.
struct NoiseInitiator {
    private var symmetric = NoiseSymmetricState()
    private let ephemeral: Curve25519.KeyAgreement.PrivateKey
    private let remoteStatic: Data
    private var sent = false

    /// `ephemeral` is for the test vectors only. Production code leaves it out, so each
    /// handshake gets a fresh key.
    init(prologue: Data, remoteStatic: Data, ephemeral: Curve25519.KeyAgreement.PrivateKey = .init()) {
        self.ephemeral = ephemeral
        self.remoteStatic = remoteStatic
        symmetric.mixHash(prologue)
        symmetric.mixHash(remoteStatic)
    }

    mutating func writeMessage1(payload: Data = Data()) throws -> Data {
        guard !sent else { throw NoiseError.wrongState }
        let publicKey = ephemeral.publicKey.rawRepresentation
        symmetric.mixHash(publicKey)
        symmetric.mixKey(try diffieHellman(ephemeral, remoteStatic))
        let message = publicKey + (try symmetric.encryptAndHash(payload))
        sent = true
        return message
    }

    /// Reads `e, ee`. Returns the payload and the transport session.
    mutating func readMessage2(_ message: Data) throws -> (payload: Data, transport: NoiseTransport) {
        guard sent else { throw NoiseError.wrongState }
        guard message.count >= dhLength + tagLength else { throw NoiseError.malformedMessage }
        let remoteEphemeral = Data(message.prefix(dhLength))
        symmetric.mixHash(remoteEphemeral)
        symmetric.mixKey(try diffieHellman(ephemeral, remoteEphemeral))
        let payload = try symmetric.decryptAndHash(Data(message.dropFirst(dhLength)))
        let (first, second) = symmetric.split()
        return (payload, NoiseTransport(sending: first, receiving: second, handshakeHash: symmetric.hash))
    }
}

/// The responder of NK. The phone never needs it. It is here so the tests can play the
/// Mac and so the vectors check both sides.
struct NoiseResponder {
    private var symmetric = NoiseSymmetricState()
    private let staticKey: Curve25519.KeyAgreement.PrivateKey
    private let ephemeral: Curve25519.KeyAgreement.PrivateKey
    private var remoteEphemeral: Data?

    init(prologue: Data, staticKey: Curve25519.KeyAgreement.PrivateKey, ephemeral: Curve25519.KeyAgreement.PrivateKey = .init()) {
        self.staticKey = staticKey
        self.ephemeral = ephemeral
        symmetric.mixHash(prologue)
        symmetric.mixHash(staticKey.publicKey.rawRepresentation)
    }

    mutating func readMessage1(_ message: Data) throws -> Data {
        guard remoteEphemeral == nil else { throw NoiseError.wrongState }
        guard message.count >= dhLength + tagLength else { throw NoiseError.malformedMessage }
        let re = Data(message.prefix(dhLength))
        symmetric.mixHash(re)
        symmetric.mixKey(try diffieHellman(staticKey, re))
        let payload = try symmetric.decryptAndHash(Data(message.dropFirst(dhLength)))
        remoteEphemeral = re
        return payload
    }

    mutating func writeMessage2(payload: Data = Data()) throws -> (message: Data, transport: NoiseTransport) {
        guard let re = remoteEphemeral else { throw NoiseError.wrongState }
        let publicKey = ephemeral.publicKey.rawRepresentation
        symmetric.mixHash(publicKey)
        symmetric.mixKey(try diffieHellman(ephemeral, re))
        let message = publicKey + (try symmetric.encryptAndHash(payload))
        let (first, second) = symmetric.split()
        // The responder sends with the second cipher state.
        return (message, NoiseTransport(sending: second, receiving: first, handshakeHash: symmetric.hash))
    }
}
