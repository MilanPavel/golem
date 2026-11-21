import CryptoKit
import Foundation
import Security

/// The phone's long-term key: ECDSA P-256, used only to sign (ADR-051). It proves the phone
/// to the relay and, inside the Noise channel, to the Mac. It takes no part in key agreement.
///
/// The connection holds a `DeviceKey`, never key bytes, so the real key can stay in the
/// Secure Enclave. Tests use `InMemoryDeviceKey`.
public protocol DeviceKey: Sendable {
    /// The public key, 65 bytes, uncompressed (`0x04 || x || y`).
    var publicKey: Data { get }
    /// An ECDSA signature with SHA-256 over `message`, 64 bytes, raw `r || s`.
    func sign(_ message: Data) throws -> Data
}

public extension DeviceKey {
    /// SHA-256 of the public key. The first 16 bytes are the device id.
    var keyHash: Data { Data(SHA256.hash(data: publicKey)) }
    /// The device id, 16 bytes.
    var deviceID: Data { keyHash.prefix(16) }
    /// The device id as the Mac's registry writes it: 32 lowercase hex characters.
    var deviceIDHex: String { deviceID.map { String(format: "%02x", $0) }.joined() }
}

public enum DeviceKeyError: Error, Equatable {
    case secureEnclaveUnavailable
    case keychain(OSStatus)
}

/// A software key that lives in memory. For tests and previews, never for the app.
public struct InMemoryDeviceKey: DeviceKey {
    private let key: P256.Signing.PrivateKey

    public init() {
        key = P256.Signing.PrivateKey()
    }

    public var publicKey: Data { key.publicKey.x963Representation }

    public func sign(_ message: Data) throws -> Data {
        try key.signature(for: message).rawRepresentation
    }
}

/// The real key: a P-256 key made inside the Secure Enclave, which cannot be exported.
///
/// The Keychain holds only the key's opaque blob (`dataRepresentation`), which is useless on
/// another device. The first call makes the key, and later calls find it again.
///
/// The key is usable after the first unlock since boot and never leaves this device, so a
/// reconnect in the background works. It asks for no Face ID: ADR-052 puts that on the
/// approval, not on the connection.
public struct SecureEnclaveDeviceKey: DeviceKey {
    private let key: SecureEnclave.P256.Signing.PrivateKey

    /// - Parameters:
    ///   - service: the Keychain service the blob is filed under.
    ///   - accessGroup: the shared access group, so the app and its extensions find one key.
    public init(service: String = "golem.device-key", accessGroup: String? = nil) throws {
        if let blob = try Self.load(service: service, accessGroup: accessGroup) {
            key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
            return
        }
        guard SecureEnclave.isAvailable else { throw DeviceKeyError.secureEnclaveUnavailable }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, &error)
        else { throw error!.takeRetainedValue() }
        let made = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
        try Self.save(made.dataRepresentation, service: service, accessGroup: accessGroup)
        key = made
    }

    public var publicKey: Data { key.publicKey.x963Representation }

    public func sign(_ message: Data) throws -> Data {
        try key.signature(for: message).rawRepresentation
    }

    private static func query(service: String, accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "device-signing-key",
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    private static func load(service: String, accessGroup: String?) throws -> Data? {
        var request = query(service: service, accessGroup: accessGroup)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw DeviceKeyError.keychain(status) }
        return data
    }

    private static func save(_ blob: Data, service: String, accessGroup: String?) throws {
        var request = query(service: service, accessGroup: accessGroup)
        request[kSecValueData as String] = blob
        request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(request as CFDictionary, nil)
        guard status == errSecSuccess else { throw DeviceKeyError.keychain(status) }
    }
}
