import CryptoKit
import Foundation
import Security

/// The device key where there is no Secure Enclave (the Simulator): a P-256 software key whose
/// 32 secret bytes sit in the Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
///
/// It is weaker than the Secure Enclave key, since the bytes can be read by the app. A real
/// iPhone never uses it: `DeviceKeys.load` picks the Secure Enclave there.
public struct KeychainDeviceKey: DeviceKey {
    private let key: P256.Signing.PrivateKey

    public init(service: String = "golem.device-key.software") throws {
        if let raw = try Self.load(service: service) {
            key = try P256.Signing.PrivateKey(rawRepresentation: raw)
            return
        }
        let made = P256.Signing.PrivateKey()
        try Self.save(made.rawRepresentation, service: service)
        key = made
    }

    public var publicKey: Data { key.publicKey.x963Representation }

    public func sign(_ message: Data) throws -> Data {
        try key.signature(for: message).rawRepresentation
    }

    private static func query(service: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "device-signing-key",
        ]
    }

    private static func load(service: String) throws -> Data? {
        var request = query(service: service)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw DeviceKeyError.keychain(status) }
        return data
    }

    private static func save(_ raw: Data, service: String) throws {
        var request = query(service: service)
        request[kSecValueData as String] = raw
        request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(request as CFDictionary, nil)
        guard status == errSecSuccess else { throw DeviceKeyError.keychain(status) }
    }
}

public enum DeviceKeys {
    /// The device key, made on first use: the Secure Enclave key where there is one, the
    /// Keychain software key where there is not.
    public static func load() throws -> any DeviceKey {
        if SecureEnclave.isAvailable {
            return try SecureEnclaveDeviceKey()
        }
        return try KeychainDeviceKey()
    }
}
