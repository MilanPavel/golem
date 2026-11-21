import CryptoKit
import Foundation

/// The pairing confirmation (ADR-051): three words from the BIP-39 English list, taken from the
/// first 33 bits of `HKDF-SHA256(ikm = h, salt = empty, info = "golem-pair-sas-v1")`. The Mac
/// computes the same from the same handshake hash, so a person can compare the two screens.
public enum PairWords {
    static let info = Data("golem-pair-sas-v1".utf8)

    /// The three words for the handshake hash `h`.
    public static func words(handshakeHash h: Data) -> [String] {
        let derived = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: h), salt: Data(), info: info, outputByteCount: 5)
        let bytes = derived.withUnsafeBytes { Array($0) }
        // 40 bits, big-endian, of which the top 33 count: three 11-bit indexes, most significant first.
        var accumulator: UInt64 = 0
        for byte in bytes { accumulator = (accumulator << 8) | UInt64(byte) }
        let top = accumulator >> 7
        return (0..<3).map { index in
            Bip39English.words[Int((top >> UInt64(22 - 11 * index)) & 0x7ff)]
        }
    }
}
