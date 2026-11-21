import Foundation
import Security

/// Everything the phone keeps about its paired Mac. Public keys and an address: the phone's
/// own secret is the device key, which lives in the Secure Enclave or the Keychain.
public struct PairedMac: Codable, Equatable, Sendable {
    public var relayURL: URL
    /// 65 bytes, uncompressed.
    public var macSigningKey: Data
    /// 32 bytes.
    public var macNoiseKey: Data
    public var name: String

    public init(relayURL: URL, macSigningKey: Data, macNoiseKey: Data, name: String) {
        self.relayURL = relayURL
        self.macSigningKey = macSigningKey
        self.macNoiseKey = macNoiseKey
        self.name = name
    }

    public init(link: PairLink) {
        self.init(
            relayURL: link.relayURL, macSigningKey: link.macSigningKey, macNoiseKey: link.macNoiseKey,
            name: link.macName)
    }

    /// The settings of a connection to this Mac.
    public func connectionConfig(clientName: String = "ios", timing: ConnectionTiming = .standard) -> ConnectionConfig {
        ConnectionConfig(
            relayURL: relayURL, macSigningKey: macSigningKey, macNoiseKey: macNoiseKey, clientName: clientName,
            timing: timing)
    }
}

/// Where the paired Mac is kept between launches.
public protocol MacStore: Sendable {
    func load() throws -> PairedMac?
    func save(_ mac: PairedMac) throws
    func forget() throws
}

/// A store in memory, for tests and previews.
public final class InMemoryMacStore: MacStore, @unchecked Sendable {
    private let lock = NSLock()
    private var mac: PairedMac?

    public init(_ mac: PairedMac? = nil) { self.mac = mac }

    public func load() throws -> PairedMac? { lock.withLock { mac } }
    public func save(_ mac: PairedMac) throws { lock.withLock { self.mac = mac } }
    public func forget() throws { lock.withLock { mac = nil } }
}

/// The Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: readable in the background
/// after the first unlock, and never copied to another device or a backup.
///
/// No access group is named, so an item goes into the app's first `keychain-access-groups`
/// entitlement, which is the group the app and its later extensions share.
public struct KeychainMacStore: MacStore {
    private let service: String

    public init(service: String = "golem.paired-mac") {
        self.service = service
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "mac",
        ]
    }

    public func load() throws -> PairedMac? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw DeviceKeyError.keychain(status) }
        return try JSONDecoder().decode(PairedMac.self, from: data)
    }

    public func save(_ mac: PairedMac) throws {
        let data = try JSONEncoder().encode(mac)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw DeviceKeyError.keychain(status) }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw DeviceKeyError.keychain(added) }
    }

    public func forget() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw DeviceKeyError.keychain(status) }
    }
}
